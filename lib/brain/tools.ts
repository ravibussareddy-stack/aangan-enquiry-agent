/**
 * Server-side tool execution for the voice agent. The agent proposes facts;
 * these functions decide (hard rules, decision bands, budget gate) and return
 * only what the agent needs to say next — never a price or a budget floor.
 */
import { ToolArgs, type ToolName } from "../../agent/tools";
import { pickSlots } from "../booking/pick-slots";
import type { Calendar, EventType } from "../booking/types";
import type { RuntimeConfig } from "../config/runtime";
import type { Crm } from "../crm/types";
import { evaluateLead } from "../qualify/evaluate";
import { runHardRules, type HardRuleResult } from "../qualify/rules";
import { budgetEchoed } from "../compliance/price-scan";
import { routeForInfo } from "../qualify/routing";
import { typicalBudgetLine, typicalBudgetRepeat } from "../qualify/typical-budget";
import { INTAKE_FIELDS, intakeStatus, labelFor, sanitizeNotKnown } from "../intake/sheet";
import type { DeclineReason } from "../schema/lead";
import { isOfficeHours, nextOpening, speakableSlot } from "../time/ist";
import { factsToExtraction } from "./facts";
import { mergeFacts, type SessionState } from "./state";

export interface BrainDeps {
  calendar: Calendar;
  crm: Crm;
  config: RuntimeConfig;
  now: () => Date;
  /** Fire-and-forget: alert seniors immediately (Telegram URGENT). */
  onComplaint?: (state: SessionState) => Promise<void>;
  /** Earlier facts for this phone number from a dropped call, if any. */
  previousFacts?: (phone: string) => Promise<SessionState["facts"] | null>;
}

/** Friendly, figure-free explanations for each decline reason. */
const DECLINE_REASON_LINES: Record<DeclineReason, string> = {
  area: "We only work in Pune city and PCMC at the moment — our contractors and vendors need to be on site, so we wouldn't be able to take this on.",
  category: "Restaurants, cafés, hotels, retail stores and gyms are outside what we design — they need a studio that specialises in those spaces.",
  engagement:
    "We're a full-service studio — every project includes design and execution together, so we don't take on advice-only, decor-only, Vastu-only, furniture-only or structural work.",
  commercial_size: "That size is outside the range of commercial spaces our team is set up for.",
  timeline: "Our design phase alone takes three to four weeks before execution starts, so we couldn't do justice to a project on that timeline.",
  budget:
    "Thank you for sharing that. Honestly, the budget is likely below what this scope involves with full design and execution, so I wouldn't want to take up your time with a consultation.",
  out_of_scope: "This doesn't sound like the kind of project our studio takes on.",
  multiple_criteria: "From what you've described, this may not be the right fit for us right now.",
};

function declineSay(reason: DeclineReason | null, cfg: RuntimeConfig) {
  return `${reason ? DECLINE_REASON_LINES[reason] + " " : ""}${cfg.declineLine}`;
}

function elapsedS(state: SessionState, now: Date) {
  return (now.getTime() - new Date(state.startedAt).getTime()) / 1000;
}

function askFor(rule: HardRuleResult): string | null {
  switch (rule.rule) {
    case "service_area":
      return "Ask for the locality and PIN code (to confirm coverage and match a nearby designer).";
    case "excluded_engagement":
      return "Ask one direct question: do they want design AND execution, or advice/ideas only?";
    case "commercial_size":
      return rule.status === "unclear" ? "Ask the approximate carpet area of the space." : null;
    case "timeline":
      return rule.status === "unclear" ? "Ask when they need the project complete." : null;
    default:
      return null;
  }
}

/** True if the quote appears in something the caller actually said. */
function callerSaid(state: SessionState, quote: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const q = norm(quote);
  return q.length >= 2 && state.transcript.some((t) => t.speaker === "caller" && norm(t.text).includes(q));
}

/** The next intake question, for tool results — never the one just prompted (no repeats). */
function nextQuestion(state: SessionState, cfg: RuntimeConfig): Record<string, unknown> {
  const intake = intakeStatus(state.facts, { askBudget: cfg.askBudget });
  if (!intake.missing.length) return { intake: "complete" };
  const last = state.intakePrompted.at(-1);
  const key = intake.missing.find((k) => k !== last) ?? intake.missing[0];
  state.intakePrompted.push(key);
  return { next_question: INTAKE_FIELDS.find((f) => f.key === key)!.question, still_missing: intake.missing.map(labelFor) };
}

/** Keep only legitimate "caller didn't know" marks. */
function cleanNotKnown(state: SessionState) {
  state.facts = { ...state.facts, not_known: sanitizeNotKnown(state.facts.not_known, state.intakePrompted) };
}

function eventTypeFor(state: SessionState, siteVisit: boolean): EventType {
  if (siteVisit || state.facts.wants_site_visit) return "site_visit";
  return state.facts.project_type === "commercial" ? "commercial_consult" : "residential_consult";
}

const callerTurns = (state: SessionState) => state.transcript.filter((t) => t.speaker === "caller").length;

export async function executeTool(
  name: ToolName,
  rawArgs: unknown,
  state: SessionState,
  deps: BrainDeps,
): Promise<Record<string, unknown>> {
  const parsed = ToolArgs[name].safeParse(rawArgs ?? {});
  if (!parsed.success) {
    return { error: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` };
  }
  const args = parsed.data as Record<string, unknown>;
  const cfg = deps.config;
  const now = deps.now();
  const wrapUp = elapsedS(state, now) > cfg.callLimits.soft_wrap_s;
  const withWrap = (r: Record<string, unknown>) => (wrapUp ? { ...r, wrap_up_now: true } : r);

  /**
   * The owner's budget rule (2026-10-08/09), enforced on every path except a hard decline:
   * ask for a ballpark; if none, share the typical range with its disclaimer and ask
   * "Are you comfortable going ahead on that basis?"; continue only if they are.
   * Not comfortable / unsure → ask their range once. Returns the next step, null when
   * done, or "not_comfortable" when they weren't happy with it and gave no range.
   */
  const budgetStep = (): Record<string, unknown> | "not_comfortable" | null => {
    if (state.facts.budget_inr != null) return null;
    const declined = (state.facts.not_known ?? []).includes("budget");
    if (cfg.askBudget && !declined && !state.budgetAsked && !state.intakePrompted.includes("budget")) {
      state.budgetAsked = true;
      state.intakePrompted.push("budget");
      return {
        next_step: "ask",
        ask: "Do you have a ballpark budget in mind for this?",
        note: "If they give a figure, put it in facts.budget_inr, repeat it back once as a short question, and call evaluate_lead. If they don't have one or would rather not say, add \"budget\" to facts.not_known and call evaluate_lead again.",
      };
    }
    if (!cfg.shareTypicalBudget) return null;
    if (!state.budgetGuidance) {
      const line = typicalBudgetLine(factsToExtraction(state.facts, state.startedAt), cfg.typicalBudgets);
      state.budgetGuidance = line;
      state.approvedLines = [...(state.approvedLines ?? []), line];
      return {
        next_step: "budget_check",
        say: line,
        rule: "Say this EXACTLY as written (no other figure), then wait for their answer and call evaluate_lead with facts.typical_budget_reaction = comfortable | not_comfortable | unsure.",
      };
    }
    const reaction = state.facts.typical_budget_reaction;
    if (!reaction || reaction === "not_asked") {
      return { next_step: "budget_check", ask: "Are you comfortable going ahead on that basis?", note: "Record their answer in facts.typical_budget_reaction and call evaluate_lead again." };
    }
    if (reaction === "comfortable") return null;
    if (!state.budgetRangeAsked) {
      state.budgetRangeAsked = true;
      return {
        next_step: "ask",
        ask: "No problem — what range did you have in mind?",
        note: "If they give a figure, put it in facts.budget_inr (upper bound), repeat it back once, and call evaluate_lead. If they'd rather not say, call evaluate_lead again with the same facts.",
      };
    }
    return "not_comfortable";
  };

  switch (name) {
    case "lookup_caller": {
      if (!state.callerPhone) return { existing_client: false, note: "Caller number unavailable." };
      const lookup = await deps.crm.lookupByPhone(state.callerPhone).catch(() => null);
      state.lookup = lookup;
      const previous = deps.previousFacts ? await deps.previousFacts(state.callerPhone).catch(() => null) : null;
      if (previous) state.facts = mergeFacts(previous, state.facts);
      return {
        existing_client: lookup?.existingClient ?? false,
        name: lookup?.name ?? null,
        open_project: lookup?.openProject ?? null,
        previously_captured: previous ?? null,
      };
    }

    case "escalate_complaint": {
      const a = args as { summary: string; wants_senior: string | null; about_existing_aangan_project: boolean; free_times: string | null };
      if (!a.about_existing_aangan_project && !state.lookup?.existingClient) {
        state.facts = mergeFacts(state.facts, { frustrated: true, complaint_detected: false });
        return {
          escalated: false,
          error:
            "Not an existing-client complaint. Apologise sincerely for the missed follow-up, then continue qualifying them as a new enquiry (they are a repeat caller — note it).",
        };
      }
      state.facts = mergeFacts(state.facts, { complaint_detected: true });
      state.complaint = { summary: a.summary, wantsSenior: a.wants_senior };
      if (a.free_times) state.callbackWindow = a.free_times;
      state.evaluation = { outcome: "complaint", declineReason: null, flags: ["frustrated"], reasons: ["Existing client complaint"] };
      void deps.onComplaint?.(state).catch(() => {});
      return {
        escalated: true,
        say: "Apologise, say a senior member of the team will call back as soon as possible (no specific time), thank them, then call end_call.",
      };
    }

    case "check_scope": {
      const a = args as { facts: SessionState["facts"]; clear?: string[] };
      state.facts = mergeFacts(state.facts, a.facts, a.clear);
      cleanNotKnown(state);
      const lead = factsToExtraction(state.facts, state.startedAt);
      const { results } = runHardRules(lead, cfg.qualify, new Date(state.startedAt));
      const fail = results.find((r) => r.status === "fail");
      if (fail) {
        state.scope = { status: "out_of_scope", reasons: [fail.reason] };
        return withWrap({ status: "out_of_scope", say_line: declineSay(fail.declineReason ?? null, cfg), then: "end_call" });
      }
      if (lead.out_of_scope_confidence >= cfg.qualify.scopeThreshold) {
        state.scope = { status: "out_of_scope", reasons: ["Agent out-of-scope confidence"] };
        return withWrap({ status: "out_of_scope", say_line: declineSay("out_of_scope", cfg), then: "end_call" });
      }
      const open = results.filter((r) => r.status !== "pass");
      if (open.length) {
        state.scope = { status: "uncertain", reasons: open.map((r) => r.reason) };
        return withWrap({
          status: "uncertain",
          ask_next: open.map(askFor).filter(Boolean),
          ...nextQuestion(state, cfg),
          note: "Keep collecting. Don't decline. If still unclear at the end, a designer will confirm fit and call back.",
        });
      }
      state.scope = { status: "in_scope", reasons: [] };
      return withWrap({ status: "in_scope", ...nextQuestion(state, cfg), then: "When the intake sheet is complete, call evaluate_lead." });
    }

    case "evaluate_lead": {
      if (state.facts.call_intent && state.facts.call_intent !== "new_enquiry" && state.facts.call_intent !== "existing_project_issue") {
        return { next_step: "message", do: "This isn't a new enquiry: take a message with take_message (ask what it's about and when to call back)." };
      }
      const a = args as { facts: SessionState["facts"]; clear?: string[]; in_scope_confidence: number; out_of_scope_confidence: number };
      state.facts = mergeFacts(state.facts, { ...a.facts, in_scope_confidence: a.in_scope_confidence, out_of_scope_confidence: a.out_of_scope_confidence }, a.clear);
      cleanNotKnown(state);
      // Enforced server-side, not left to the prompt:
      // 1. Never evaluate before we know what work they want.
      if (!state.facts.scope_text || !state.facts.engagement || state.facts.engagement === "unknown") {
        return withWrap({ next_step: "ask", ask: "First ask what they'd like done — which rooms or areas, full or partial, design with execution?" });
      }
      // 2. Intake sheet: don't decide while required fields are still unasked. Safety valve:
      //    at most two nudges, and never once the call is past the soft wrap-up time.
      //    A hard-rule decline or a complaint needs no more questions.
      const pre = evaluateLead(factsToExtraction(state.facts, state.startedAt), cfg.qualify, new Date(state.startedAt));
      const settled = pre.outcome === "complaint" || (pre.outcome === "declined" && pre.declineReason !== "budget");
      const intake = intakeStatus(state.facts, { askBudget: cfg.askBudget });
      if (!settled && intake.missing.length && state.intakeGates < 2 && !wrapUp) {
        state.intakeGates += 1;
        if (intake.next) state.intakePrompted.push(intake.next.key);
        return withWrap({
          next_step: "ask",
          missing: intake.missing.map(labelFor),
          ask: intake.next?.question,
          note: "Ask for the missing items (combine two if natural). If the caller doesn't know or won't say, add the field key to facts.not_known and move on. Then call evaluate_lead again.",
        });
      }
      // 3. The owner's budget step — not skipped by the nudge limit or the wrap-up time.
      const budget = settled ? null : budgetStep();
      if (budget && budget !== "not_comfortable") return withWrap(budget);
      if (budget === "not_comfortable") {
        state.facts = mergeFacts(state.facts, { watch_for: ["not comfortable with the typical budget range; no range given"] });
        state.evaluation = {
          outcome: "review",
          declineReason: null,
          flags: ["typical_budget_not_comfortable"],
          reasons: ["Not comfortable with the typical budget range and gave no range of their own"],
        };
        return withWrap({
          next_step: "review",
          budget_not_comfortable: true,
          must_ask: "When are you generally free to take a call?",
          do: "Don't offer a booking. Thank them, say our team will look at their details and get back to them as soon as possible about what could work for their budget, ask when they're generally free, then call request_callback with their exact words.",
        });
      }
      // 4. A budget counts as confirmed only if the transcript shows it was repeated back.
      if (state.facts.budget_inr != null) {
        const echoed = budgetEchoed(state.transcript, state.facts.budget_inr);
        state.facts = { ...state.facts, budget_confirmed: echoed };
        if (!echoed) {
          return withWrap({
            next_step: "confirm_budget",
            ask: "Repeat the caller's budget figure back once, exactly as they said it, as a short question — then call evaluate_lead again.",
          });
        }
      }
      const e = evaluateLead(factsToExtraction(state.facts, state.startedAt), cfg.qualify, new Date(state.startedAt));
      state.evaluation = { outcome: e.outcome, declineReason: e.declineReason, flags: e.flags, reasons: e.reasons };
      // Not enough captured to act on → helpdesk callback instead of a decision.
      const routed = routeForInfo({
        outcome: e.outcome,
        missing: intakeStatus(state.facts, { askBudget: cfg.askBudget }).missing,
        booked: !!state.booking,
        rule: cfg.insufficientInfo,
      });
      if (routed.status === "callback") {
        state.evaluation = { ...state.evaluation, outcome: "callback", reasons: [`Missing: ${routed.missingCore.map(labelFor).join(", ")}`, ...e.reasons] };
        return withWrap({
          next_step: "callback",
          do: "Say a member of our team will get back to them as soon as possible to complete a few details. ASK when they're generally free, then call request_callback with their exact words, thank them and end the call.",
        });
      }
      // No budget from the caller → share the typical budget once (server-written, verbatim).
      const guidance = (): Record<string, unknown> => {
        if (!cfg.shareTypicalBudget || state.facts.budget_inr != null || state.budgetGuidance) return {};
        state.budgetGuidance = typicalBudgetLine(factsToExtraction(state.facts, state.startedAt), cfg.typicalBudgets);
        state.approvedLines = [...(state.approvedLines ?? []), state.budgetGuidance];
        return { budget_guidance: state.budgetGuidance, budget_guidance_rule: "Say budget_guidance EXACTLY as written, once, before the next step. Don't add or change any figure." };
      };
      switch (e.outcome) {
        case "qualified":
          return withWrap({ next_step: "qualified", ...guidance(), do: "Call get_slots and offer the 2–3 times it returns, then book_slot." });
        case "review":
          return withWrap({
            next_step: "review",
            ...guidance(),
            must_ask: "When are you generally free to take a call?",
            ask_next: e.askNext ? `If not yet asked, ask one direct question about: ${e.askNext}` : null,
            do: "Ask when they're generally free to take a call, call request_callback, and say a designer will look at the details and get back to them as soon as possible (no promised time).",
          });
        case "redirect":
          return withWrap({ next_step: "redirect", do: "Call transfer_to_front_desk and follow its result." });
        case "complaint":
          return withWrap({ next_step: "complaint", do: "Call escalate_complaint." });
        case "declined":
          return withWrap({ next_step: "declined", say_line: declineSay(e.declineReason, cfg), then: "end_call" });
      }
    }

    case "typical_budget": {
      const a = args as { facts?: SessionState["facts"] };
      state.facts = mergeFacts(state.facts, a.facts);
      state.facts = mergeFacts(state.facts, { asked_about_price: true });
      const x = factsToExtraction(state.facts, state.startedAt);
      if (!state.budgetGuidance) {
        const line = typicalBudgetLine(x, cfg.typicalBudgets);
        state.budgetGuidance = line;
        state.approvedLines = [...(state.approvedLines ?? []), line];
        return { say: line, rule: "Say this exactly, then wait for their answer (comfortable / not comfortable) and record it as typical_budget_reaction." };
      }
      const repeat = typicalBudgetRepeat(x, cfg.typicalBudgets);
      state.approvedLines = [...(state.approvedLines ?? []), repeat];
      return { say: repeat, rule: "Say this exactly, then continue where you were. Don't add or change any figure." };
    }

    case "get_slots": {
      const a = args as { preference: string | null; site_visit: boolean; typical_budget_reaction?: SessionState["facts"]["typical_budget_reaction"] };
      // Typical budget shared → the caller must have answered "Are you comfortable going ahead on that basis?" first.
      if (state.budgetGuidance && state.facts.budget_inr == null) {
        const reaction = a.typical_budget_reaction ?? state.facts.typical_budget_reaction;
        if (!reaction || reaction === "not_asked") {
          return { error: "Before offering times: you shared the typical range — wait for their answer to \"Are you comfortable going ahead on that basis?\" and pass it as typical_budget_reaction." };
        }
        state.facts = mergeFacts(state.facts, { typical_budget_reaction: reaction });
        // Continue only if they're happy with the typical range (owner's rule).
        if (reaction !== "comfortable") {
          return {
            error:
              "They haven't said they're comfortable with the typical range, so don't offer times. Call evaluate_lead with facts.typical_budget_reaction set to their answer — it will ask their range or route to review.",
          };
        }
      }
      const allowed = state.purpose === "review_approval" || state.evaluation?.outcome === "qualified";
      // (callback / review leads never get slots in-call)
      if (!allowed) return { error: "Only offer slots after evaluate_lead returns qualified." };
      const eventType = eventTypeFor(state, a.site_visit);
      const open = await deps.calendar.openSlots(eventType, now, new Date(now.getTime() + 7 * 86_400_000));
      const slots = pickSlots(open, eventType, a.preference, now, 3);
      state.slotsOffered = slots;
      state.slotsOfferedAtCallerTurn = callerTurns(state);
      if (!slots.length) {
        return { slots: [], do: "No times free this week: take their preferred callback window with request_callback." };
      }
      return withWrap({ slots: slots.map((s) => ({ slot_id: s.id, time: s.label })), offer: "Offer 2 or 3 of these by name." });
    }

    case "book_slot": {
      const a = args as { slot_id: string; caller_name: string };
      const slot = state.slotsOffered.find((s) => s.id === a.slot_id);
      if (!slot) return { error: `Unknown slot_id ${a.slot_id}. Use one returned by get_slots.` };
      if (state.booking) return { already_booked: state.booking.label };
      // Never book in the same breath as the offer: the caller must hear the time and say yes.
      if (state.slotsOfferedAtCallerTurn != null && callerTurns(state) <= state.slotsOfferedAtCallerTurn) {
        return { booked: false, error: "The caller hasn't heard these times yet. Offer them now, wait for their choice, then call book_slot." };
      }
      try {
        const booking = await deps.calendar.book({
          slot,
          leadRef: state.leadId ?? state.callId,
          name: a.caller_name || state.facts.caller_name || "Caller",
          phone: state.callerPhone ?? "",
          notes: state.facts.scope_text,
        });
        state.booking = { ...booking, label: speakableSlot(new Date(booking.startUtc)), eventType: slot.eventType };
        return { confirmed: state.booking.label, say: "Confirm the time and tell them an SMS confirmation will follow." };
      } catch (err) {
        const message = (err as Error).message ?? String(err);
        console.error(`[brain] book_slot failed for ${slot.id} (${slot.startUtc}): ${message.slice(0, 400)}`);
        // Only a genuinely taken slot means "offer another time". Any other failure (calendar
        // down, bad request) would fail for every slot, so stop and take a callback instead of looping.
        if (/taken|unavailable|already|no available|not available|conflict|409/i.test(message)) {
          state.slotsOffered = state.slotsOffered.filter((s) => s.id !== slot.id);
          return { error: "That time was just taken. Offer one of the other times, or call get_slots again." };
        }
        state.facts = mergeFacts(state.facts, { watch_for: ["booking failed in-call — book manually"] });
        return {
          booked: false,
          error:
            "The calendar couldn't take the booking right now. Don't offer more times. Apologise briefly, say our team will call them as soon as possible to confirm a consultation time, ask when they're generally free, and call request_callback with their exact words.",
        };
      }
    }

    case "take_message": {
      const a = args as { intent: string; for_person: string | null; about: string; callback_window: string; caller_quote: string };
      if (!callerSaid(state, a.caller_quote)) {
        return { recorded: false, error: "Ask when they're generally free to take a call, then call take_message with their exact words." };
      }
      state.facts = mergeFacts(state.facts, { call_intent: a.intent as SessionState["facts"]["call_intent"], requested_person: a.for_person ?? undefined, callback_window: a.callback_window });
      state.message = { intent: a.intent, forPerson: a.for_person, about: a.about, callbackWindow: a.callback_window };
      state.callbackWindow = a.callback_window;
      return {
        recorded: true,
        say: `Say we'll pass the message to ${a.for_person ?? "the right person"} and get back to them as soon as possible — we've noted they're usually free ${a.callback_window}. Don't promise a time. Thank them and call end_call.`,
      };
    }

    case "request_callback": {
      const a = args as { window: string; caller_quote: string };
      const said = callerSaid(state, a.caller_quote);
      if (!said) {
        return { recorded: false, error: "The caller hasn't said when they're free. Ask: \"When are you generally free to take a call?\" — then call request_callback with their exact words." };
      }
      state.callbackWindow = a.window;
      state.facts = mergeFacts(state.facts, { callback_window: state.callbackWindow });
      return { recorded: true, say: "Say the team will get back to them as soon as possible — you've noted when they're usually free. Don't promise a specific time or person." };
    }

    case "transfer_to_front_desk": {
      const open = isOfficeHours(now, cfg.officeHours);
      if (open && process.env.FRONT_DESK_NUMBER) {
        state.redirect = { mode: "transfer", nextOpening: null };
        return { mode: "transfer", say: "Tell them you're connecting them to the front desk now." };
      }
      const next = nextOpening(now, cfg.officeHours);
      state.redirect = { mode: "callback_task", nextOpening: next.toISOString() };
      return {
        mode: "callback_task",
        office_opens: speakableSlot(next),
        say: "Say the front desk will get back to them as soon as possible once the office opens (don't promise a time). Ask when they're generally free and record it with request_callback.",
      };
    }

    case "end_call": {
      // Review / callback / redirect leads need a callback time from the caller before we hang up.
      const needsCallback = ["review", "callback", "redirect"].includes(state.evaluation?.outcome ?? "") && !state.message;
      if (needsCallback && !state.callbackWindow && !state.endRefused) {
        state.endRefused = true;
        return {
          ok: false,
          error: "Don't end yet: ask \"When are you generally free to take a call?\", then call request_callback with their exact words, then end_call.",
        };
      }
      state.ended = true;
      state.endReason = (args as { reason: string }).reason;
      return { ok: true };
    }
  }
}
