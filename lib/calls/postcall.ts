/**
 * Post-call pipeline (runs once per call, idempotent on provider call id):
 *   price-leak scan → structured extraction (the stored version) → evaluateLead
 *   → persist call, lead, criteria, booking, costs → drop recovery → handoff.
 */
import type { SessionState } from "../brain/state";
import { factsToExtraction } from "../brain/facts";
import { scanTranscriptForPriceLeak } from "../compliance/price-scan";
import { loadRuntimeConfig } from "../config/runtime";
import { callCostRows, type Rate } from "../cost/compute";
import { db } from "../db/client";
import { extractLead } from "../extract/extract";
import { evaluateLead } from "../qualify/evaluate";
import { intakeFromExtraction, labelFor } from "../intake/sheet";
import { routeForInfo } from "../qualify/routing";
import { computeDealHealth } from "../deal-health/store";
import type { LeadExtraction } from "../schema/lead";
import { isOfficeHours } from "../time/ist";
import type { CallUsage, NormalizedTurn } from "../voice/types";

export interface CompletedCall {
  provider: string;
  providerCallId: string;
  direction: "inbound" | "outbound";
  callerPhone: string | null;
  startedAt: Date;
  endedAt: Date;
  durationS: number;
  transcript: NormalizedTurn[];
  recordingUrl: string | null;
  summary: string | null;
  endReason: string | null;
  isSimulated: boolean;
  usage: CallUsage;
  session?: SessionState | null;
}

export interface PostCallResult {
  callId: string;
  leadId: string | null;
  status: string | null;
  priceLeak: boolean;
  dropped: boolean;
}

async function loadSession(providerCallId: string): Promise<SessionState | null> {
  const { rows } = await db().query<{ state: SessionState }>("select state from call_sessions where provider_call_id = $1", [providerCallId]);
  return rows[0]?.state ?? null;
}

export async function saveSession(state: SessionState): Promise<void> {
  await db().query(
    `insert into call_sessions (provider_call_id, provider, state, updated_at) values ($1, $2, $3, now())
     on conflict (provider_call_id) do update set state = excluded.state, updated_at = now()`,
    [state.callId, state.provider, JSON.stringify({ ...state, history: [] })],
  );
}

export async function processCompletedCall(input: CompletedCall): Promise<PostCallResult> {
  const cfg = await loadRuntimeConfig();
  if (input.session) await saveSession(input.session); // simulator passes state directly; keep it for metrics/handoff
  const session = input.session ?? (await loadSession(input.providerCallId));
  const turns = input.transcript.length ? input.transcript : (session?.transcript ?? []).map((t) => ({ speaker: t.speaker, text: t.text }));

  const existing = await db().query<{ id: string; caller_phone: string }>(
    "select id, caller_phone from calls where provider = $1 and provider_call_id = $2",
    [input.provider, input.providerCallId],
  );
  const callerPhone = input.callerPhone ?? session?.callerPhone ?? existing.rows[0]?.caller_phone ?? "unknown";

  // Idempotent: a call that already produced a lead is never processed twice.
  if (existing.rows[0]) {
    const done = await db().query<{ id: string; status: string; price_leak: boolean; dropped: boolean }>(
      "select l.id, l.status, c.price_leak, c.dropped from leads l join calls c on c.id = l.call_id where c.id = $1 limit 1",
      [existing.rows[0].id],
    );
    if (done.rows[0]) {
      const d = done.rows[0];
      return { callId: existing.rows[0].id, leadId: d.id, status: d.status, priceLeak: d.price_leak, dropped: d.dropped };
    }
  }

  // 1. Price-leak scan (agent turns only).
  // The server-written typical-budget line is the only figure allowed on a call.
  const scan = scanTranscriptForPriceLeak(turns, session?.approvedLines ?? (session?.budgetGuidance ? [session.budgetGuidance] : []));
  const leak = scan.leak || (session?.guardRewrites.length ?? 0) > 0;
  const leakHits = [...scan.hits, ...(session?.guardRewrites ?? []).map((g) => ({ text: g.draft, pattern: "pre_tts_guard_rewrite", turn: -1 }))];

  // 2. Extraction — only if the caller actually said something.
  const callerSpoke = turns.some((t) => t.speaker === "caller" && t.text.trim().split(/\s+/).length >= 2);
  let extraction: LeadExtraction | null = null;
  let extractionUsage: { prompt: number; output: number } | undefined;
  let extractionFailed = false;
  if (callerSpoke) {
    try {
      const { extraction: x, response } = await extractLead(turns, input.startedAt);
      extraction = x;
      extractionUsage = { prompt: response.usage.promptTokenCount, output: response.usage.candidatesTokenCount + response.usage.thoughtsTokenCount };
    } catch (err) {
      extractionFailed = true;
      extraction = session ? factsToExtraction(session.facts, session.startedAt) : null;
      console.error("[postcall] extraction failed, using in-call facts", err);
    }
  }

  // 3. Decide.
  let evaluation = extraction ? evaluateLead(extraction, cfg.qualify, input.startedAt) : null;
  if (evaluation && session?.complaint && evaluation.outcome !== "complaint") {
    evaluation = { ...evaluation, outcome: "complaint", declineReason: null, reasons: ["Escalated in call", ...evaluation.reasons] };
  }
  // Non-enquiry calls (update / named designer / other) are messages, not leads.
  const MESSAGE_INTENTS = ["existing_project_update", "specific_designer", "other"];
  const message =
    session?.message ??
    (extraction && MESSAGE_INTENTS.includes(extraction.call_intent) && !extraction.complaint_detected && !session?.complaint
      ? { intent: extraction.call_intent, forPerson: extraction.requested_person, about: extraction.scope_text || "(see transcript)", callbackWindow: extraction.callback_window ?? "" }
      : null);
  if (message) evaluation = null;

  const notKnown = session?.facts.not_known ?? [];
  const intake = extraction && evaluation ? intakeFromExtraction(extraction, { askBudget: cfg.askBudget, outcome: evaluation.outcome, notKnown }) : null;
  // Enough captured to act on? Otherwise "Callback needed" for the helpdesk.
  const routed = evaluation && intake ? routeForInfo({ outcome: evaluation.outcome, missing: intake.missing, booked: !!session?.booking, rule: cfg.insufficientInfo }) : null;
  const status = message ? "message" : (routed?.status ?? evaluation?.outcome ?? null);
  const health =
    extraction && status === "qualified"
      ? await computeDealHealth({ extraction, callAt: input.startedAt, booked: !!session?.booking, notKnown })
      : null;
  const flags = [
    ...(status === "callback" ? ["insufficient_info"] : []),
    ...(evaluation?.flags ?? []),
    ...(extractionFailed ? ["extraction_failed"] : []),
    ...(leak ? ["price_leak"] : []),
    ...(intake?.missing.length ? ["intake_incomplete"] : []),
  ];
  if (session?.evaluation && evaluation && session.evaluation.outcome !== evaluation.outcome) flags.push(`in_call_${session.evaluation.outcome}`);

  // 4. Dropped mid-flow? (caller spoke, agent never wrapped up, nothing booked or decided)
  //    With brain state: dropped only if the call ended before the agent reached any
  //    outcome (no evaluation, no booking, no complaint, no callback taken).
  const dropped = session
    ? callerSpoke && !session.ended && !session.evaluation && !session.booking && !session.complaint && !session.callbackWindow && !session.redirect
    : callerSpoke && !["declined", "complaint", "redirect"].includes(evaluation?.outcome ?? "") && !/agent/i.test(input.endReason ?? "");

  const client = await db().connect();
  try {
    await client.query("begin");
    const afterHours = !isOfficeHours(input.startedAt, cfg.officeHours);
    const callRow = await client.query<{ id: string }>(
      `insert into calls (provider, provider_call_id, direction, caller_phone, started_at, answered_at, ended_at, duration_s,
                          after_hours, dropped, transcript, recording_url, summary, outcome, price_leak, price_leak_hits,
                          prompt_version, raw_payload, is_simulated, processed_at, answer_reason)
       values ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now(), $19)
       on conflict (provider, provider_call_id) do update set
         ended_at = excluded.ended_at, duration_s = excluded.duration_s, dropped = excluded.dropped,
         transcript = excluded.transcript, recording_url = excluded.recording_url, summary = excluded.summary,
         outcome = excluded.outcome, price_leak = excluded.price_leak, price_leak_hits = excluded.price_leak_hits,
         prompt_version = excluded.prompt_version, processed_at = now(), answer_reason = excluded.answer_reason,
         caller_phone = coalesce(nullif(calls.caller_phone, 'unknown'), excluded.caller_phone)
       returning id`,
      [
        input.provider,
        input.providerCallId,
        input.direction,
        callerPhone,
        input.startedAt,
        input.endedAt,
        Math.round(input.durationS),
        afterHours,
        dropped,
        turns.map((t) => `${t.speaker === "agent" ? "AGENT" : "USER"}: ${t.text}`).join("\n"),
        input.recordingUrl,
        input.summary,
        status,
        leak,
        JSON.stringify(leakHits),
        session?.promptVersion ?? cfg.promptVersion,
        JSON.stringify({ endReason: input.endReason, usage: input.usage.raw }),
        input.isSimulated,
        input.direction === "outbound" ? "direct" : afterHours ? "after_hours" : cfg.answerMode.mode === "overflow" ? "overflow" : "direct",
      ],
    );
    const callId = callRow.rows[0].id;

    // Message (non-enquiry) instead of a lead
    let messageId: string | null = null;
    if (message) {
      const m = await client.query<{ id: string }>(
        `insert into call_messages (call_id, intent, caller_name, phone, for_person, about, callback_window)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (call_id) do nothing returning id`,
        [callId, message.intent, extraction?.caller_name ?? session?.facts.caller_name ?? null, callerPhone, message.forPerson, message.about, message.callbackWindow || null],
      );
      messageId = m.rows[0]?.id ?? null;
    }

    // Lead (+ criteria, booking)
    let leadId: string | null = null;
    if (extraction && evaluation) {
      const booking = session?.booking ?? null;
      const designer = booking?.designer
        ? (await client.query<{ id: string }>("select id from designers where name = $1 limit 1", [booking.designer])).rows[0]?.id ?? null
        : null;
      const lead = await client.query<{ id: string }>(
        `insert into leads (call_id, channel, name, phone, project_type, category, engagement, scope_kind, scope_text, locality, pin,
                            in_area, sq_ft, rooms, site_state, timeline_text, completion_by, site_available_from, decision_maker,
                            budget_inr, budget_confirmed, budget_floor_inr, budget_flag, status, decline_reason, oos_confidence,
                            in_scope_confidence, asked_about_price, flags, watch_for, callback_window, assigned_designer_id,
                            extraction, evaluation, researched_us, referral, deal_health_score, deal_health_band, deal_health_factors)
         values ($1,'phone',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
         returning id`,
        [
          callId,
          extraction.caller_name,
          callerPhone,
          extraction.project_type,
          extraction.category,
          extraction.engagement,
          extraction.scope_kind,
          extraction.scope_text,
          extraction.locality,
          extraction.pin,
          evaluation.area.status,
          extraction.carpet_sqft,
          extraction.rooms_in_scope,
          extraction.site_state,
          extraction.timeline_text,
          extraction.completion_by,
          extraction.site_available_from,
          extraction.decision_maker,
          extraction.budget_inr,
          extraction.budget_confirmed,
          evaluation.budget.floor?.floorInr ?? null,
          evaluation.budget.status,
          status,
          evaluation.declineReason,
          extraction.out_of_scope_confidence,
          extraction.in_scope_confidence,
          extraction.asked_about_price,
          [...new Set(flags)],
          extraction.watch_for,
          extraction.callback_window ?? session?.callbackWindow ?? null,
          designer,
          JSON.stringify(extraction),
          JSON.stringify({
            ...evaluation,
            summary: input.summary,
            intake: { missing: intake?.missing ?? [], not_known: notKnown },
            ...(status === "callback" ? { reasons: [`Not enough captured to decide — missing: ${routed!.missingCore.map(labelFor).join(", ")}`, ...evaluation.reasons] } : {}),
          }),
          extraction.researched_us,
          extraction.referral,
          health?.score ?? null,
          health?.band ?? null,
          health ? JSON.stringify(health.factors) : null,
        ],
      );
      leadId = lead.rows[0].id;

      for (const [criterion, c] of Object.entries(evaluation.criteria)) {
        await client.query(
          "insert into criteria (lead_id, criterion, verdict, evidence, source) values ($1,$2,$3,$4,$5)",
          [leadId, criterion, c.verdict, c.evidence, c.source],
        );
      }
      if (booking) {
        await client.query(
          `insert into bookings (lead_id, calcom_uid, event_type, designer, designer_id, slot_start, slot_end, status)
           values ($1,$2,$3,$4,$5,$6,$7,'booked') on conflict (calcom_uid) do nothing`,
          [leadId, booking.uid, booking.eventType, booking.designer, designer, booking.startUtc, booking.endUtc],
        );
      }
    }

    // Costs
    const rates = (await client.query<Rate>("select id, component, unit, unit_rate_inr::float8 as unit_rate_inr, effective_from::text from rates")).rows;
    const costRows = callCostRows(rates, {
      at: input.startedAt,
      billedMinutes: input.usage.billedMinutes,
      voiceRaw: input.usage.raw,
      dialogue: session ? { prompt: session.usage.prompt, output: session.usage.output + session.usage.thoughts } : undefined,
      extraction: extractionUsage,
    });
    for (const r of costRows) {
      await client.query(
        "insert into call_costs (call_id, component, unit, units, unit_rate_inr, cost_inr, rate_id, raw_usage) values ($1,$2,$3,$4,$5,$6,$7,$8)",
        [callId, r.component, r.unit, r.units, r.unit_rate_inr, r.cost_inr, r.rate_id, JSON.stringify(r.raw_usage)],
      );
    }

    // Drop recovery: one outbound callback within the window.
    if (dropped && callerPhone !== "unknown" && cfg.dropRecovery.max_attempts > 0) {
      await client.query(
        `insert into outbound_attempts (lead_id, source_call_id, purpose, attempt_no, scheduled_for, result)
         values ($1,$2,'drop_recovery',1, $3, 'pending') on conflict do nothing`,
        [leadId, callId, new Date(input.endedAt.getTime() + 60_000)],
      );
    }
    await client.query("commit");

    if (messageId) {
      const { deliverMessage } = await import("../handoff/message");
      await deliverMessage(messageId).catch(async (err) => {
        const { alertOps } = await import("../integrations/telegram");
        await alertOps(`Message delivery failed for call ${callId}: ${(err as Error).message}`);
      });
    }

    // 5. Handoff + customer SMS (outside the transaction; failures alert ops, never lose the lead).
    if (leadId && status && ["qualified", "review", "complaint", "declined", "callback"].includes(status)) {
      const { runHandoff } = await import("../handoff/run");
      await runHandoff(leadId).catch(async (err) => {
        const { alertOps } = await import("../integrations/telegram");
        await alertOps(`Handoff failed for lead ${leadId}: ${(err as Error).message}`);
      });
    }
    return { callId, leadId, status, priceLeak: leak, dropped };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
