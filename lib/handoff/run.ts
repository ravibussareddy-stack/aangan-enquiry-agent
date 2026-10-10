/**
 * Handoff after a call: HubSpot sync, designer email note (seniors for
 * complaints, helpdesk for callbacks), booking confirmation SMS to the customer. Target: within
 * 2 minutes of the call ending — this runs straight after the post-call
 * pipeline (via after() in the webhook route).
 */
import { loadRuntimeConfig } from "../config/runtime";
import { getCrm, type DealStage } from "../crm";
import { db } from "../db/client";
import { buildNote } from "./note";
import { labelFor } from "../intake/sheet";
import type { LeadExtraction } from "../schema/lead";
import { sendSms } from "../sms";
import { notifyStaff } from "../staff/notify";
import { designerEmail } from "../staff/recipients";
import { speakableSlot } from "../time/ist";

interface LeadRow {
  id: string;
  status: "qualified" | "review" | "declined" | "redirect" | "complaint" | "callback";
  review_queue: "designer" | "admin";
  deal_health_score: number | null;
  deal_health_band: string | null;
  callback_window: string | null;
  phone: string;
  name: string | null;
  in_area: string;
  budget_flag: string | null;
  flags: string[];
  extraction: LeadExtraction;
  evaluation: { summary?: string | null; intake?: { missing: string[] } };
  hubspot_contact_id: string | null;
  hubspot_deal_id: string | null;
  started_at: string;
  assigned_designer_id: string | null;
  designer_chat: string | null;
  designer_name: string | null;
  booking_start: string | null;
  booking_designer: string | null;
  repeat_calls: number;
  session_complaint: { summary: string; wantsSenior: string | null } | null;
}

function stageFor(lead: LeadRow): DealStage | null {
  if (lead.status === "qualified") return lead.booking_start ? "Booked" : "New qualified";
  if (lead.status === "callback") return "Callback needed";
  if (lead.status === "review") return lead.review_queue === "admin" ? "Admin review" : "Service review";
  if (lead.status === "declined") return "Declined";
  return null;
}

async function logHandoff(leadId: string, channel: string, delivered: boolean, externalId: string | null, error?: string) {
  await db().query(
    "insert into handoffs (lead_id, channel, sent_at, delivered, external_message_id, error) values ($1,$2,now(),$3,$4,$5)",
    [leadId, channel, delivered, externalId, error ?? null],
  );
}

export async function runHandoff(leadId: string): Promise<void> {
  const cfg = await loadRuntimeConfig();
  const { rows } = await db().query<LeadRow>(
    `select l.id, l.status, l.phone, l.name, l.in_area, l.budget_flag, l.flags, l.extraction, l.evaluation,
            l.review_queue, l.deal_health_score, l.deal_health_band, l.callback_window,
            l.hubspot_contact_id, l.hubspot_deal_id, l.assigned_designer_id, c.started_at::text,
            d.telegram_chat_id::text as designer_chat, d.name as designer_name,
            b.slot_start::text as booking_start, b.designer as booking_designer,
            (select count(*)::int from calls c2 where l.phone ~ '^[+]?[0-9]{8,15}$' and c2.caller_phone = l.phone and c2.id <> c.id and c2.started_at < c.started_at) as repeat_calls,
            (s.state -> 'complaint') as session_complaint
       from leads l
       join calls c on c.id = l.call_id
       left join designers d on d.id = l.assigned_designer_id
       left join bookings b on b.lead_id = l.id and b.status = 'booked'
       left join call_sessions s on s.provider_call_id = c.provider_call_id
      where l.id = $1`,
    [leadId],
  );
  const lead = rows[0];
  if (!lead) throw new Error(`Lead ${leadId} not found`);

  // HubSpot
  let dealUrl: string | null = null;
  const stage = stageFor(lead);
  if (stage) {
    try {
      const crm = getCrm();
      const synced = await crm.syncLead({
        phone: lead.phone,
        name: lead.name,
        dealName: `${lead.name ?? "Caller"} — ${lead.extraction.configuration ?? lead.extraction.project_type} ${lead.extraction.locality ?? ""}`.trim(),
        stage,
        ownerEmail: lead.status === "qualified" ? designerEmail(lead.designer_name ?? lead.booking_designer) : null,
        priority: (lead.deal_health_band as "high" | "medium" | "low" | null) ?? null,
        existingContactId: lead.hubspot_contact_id,
        existingDealId: lead.hubspot_deal_id,
        properties: {
          status: lead.status,
          scope: lead.extraction.scope_text,
          locality: lead.extraction.locality,
          pin: lead.extraction.pin,
          sq_ft: lead.extraction.carpet_sqft,
          timeline: lead.extraction.timeline_text,
          decision_maker: lead.extraction.decision_maker,
          budget_inr: lead.extraction.budget_inr,
          flags: lead.flags.join(", "),
          deal_health: lead.deal_health_score != null ? `${lead.deal_health_score}/100 (${lead.deal_health_band})` : null,
          missing_info: (lead.evaluation.intake?.missing ?? []).map(labelFor).join(", ") || null,
          callback_window: lead.callback_window,
        },
        note: `AI phone enquiry (${lead.status}).\n${lead.evaluation.summary ?? ""}\nFlags: ${lead.flags.join(", ") || "none"}`,
      });
      dealUrl = synced.dealUrl;
      await db().query("update leads set hubspot_contact_id = $2, hubspot_deal_id = $3, hubspot_stage = $4 where id = $1", [leadId, synced.contactId, synced.dealId, stage]);
      await logHandoff(leadId, crm.provider === "hubspot" ? "hubspot" : "crm_mock", true, synced.dealId);
    } catch (err) {
      await logHandoff(leadId, "hubspot", false, null, (err as Error).message);
    }
  }

  // Staff note by email (staff only — customers get SMS)
  if (lead.status === "qualified" || lead.status === "review" || lead.status === "complaint" || lead.status === "callback") {
    const base = process.env.APP_BASE_URL ?? "";
    const note = buildNote({
      leadId,
      status: lead.status,
      extraction: lead.extraction,
      phone: lead.phone,
      calledAt: new Date(lead.started_at),
      inArea: lead.in_area,
      budgetFlag: lead.budget_flag,
      flags: lead.flags,
      booking: lead.booking_start ? { label: speakableSlot(new Date(lead.booking_start)), designer: lead.booking_designer } : null,
      summary: lead.evaluation.summary ?? null,
      repeatCaller: lead.repeat_calls > 0 || lead.extraction.repeat_caller,
      dealUrl,
      transcriptUrl: base ? `${base}/dashboard/leads/${leadId}` : null,
      complaint: lead.session_complaint,
      missing: (lead.evaluation.intake?.missing ?? []).map(labelFor),
      dealHealth: lead.deal_health_score != null ? { score: lead.deal_health_score, band: lead.deal_health_band ?? "" } : null,
      callbackWindow: lead.callback_window,
    });
    const who = lead.name ?? "Caller";
    const where = lead.extraction.locality ? ` · ${lead.extraction.locality}` : "";
    const subject =
      lead.status === "complaint"
        ? `URGENT complaint · ${who}`
        : lead.status === "callback"
          ? `Callback needed · ${who}${where}`
          : lead.status === "review"
            ? `Review needed · ${who}${where}`
            : `New lead · ${who}${where}${lead.booking_start ? " · booked" : ""}`;
    try {
      const sent = await notifyStaff({
        designer: lead.status === "qualified" ? (lead.designer_name ?? lead.booking_designer) : null,
        group: lead.status === "complaint" ? "senior" : lead.status === "callback" ? "helpdesk" : lead.status === "review" && lead.review_queue === "admin" ? "admin" : "designers",
        subject,
        text: note.text,
        buttons: note.buttons,
        telegramChat:
          lead.status === "complaint"
            ? process.env.TELEGRAM_SENIOR_CHAT_ID
            : lead.status === "callback"
              ? (process.env.TELEGRAM_HELPDESK_CHAT_ID ?? process.env.TELEGRAM_DESIGNERS_CHAT_ID)
              : (lead.designer_chat ?? process.env.TELEGRAM_DESIGNERS_CHAT_ID),
      });
      await logHandoff(leadId, sent.channel, sent.delivered, sent.externalId);
    } catch (err) {
      await logHandoff(leadId, "email", false, null, (err as Error).message);
    }
  }

  // Booking confirmation SMS (customers only ever get SMS).
  if (lead.status === "qualified" && lead.booking_start) {
    await sendLoggedSms(cfg, leadId, lead.phone, "booking_confirmation", [speakableSlot(new Date(lead.booking_start)), process.env.FRONT_DESK_NUMBER ?? "our studio"]);
  }
}

export async function sendLoggedSms(cfg: Awaited<ReturnType<typeof loadRuntimeConfig>>, leadId: string | null, to: string, template: string, vars: string[]) {
  const res = await sendSms(cfg, to, template, vars);
  await db().query(
    "insert into sms_messages (lead_id, to_phone, template, body, provider, status, provider_msg_id, error) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [leadId, to, template, res.body, res.provider, res.status, res.providerMsgId ?? null, res.error ?? null],
  );
  return res;
}
