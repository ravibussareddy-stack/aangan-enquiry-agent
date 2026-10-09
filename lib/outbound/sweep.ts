/**
 * Outbound sweep (run every minute by cron):
 *  - due drop_recovery attempts → one callback (brief: within 2 minutes, one attempt, then log)
 *  - due review_approval attempts → booking call; retried up to APPROVAL_CALLBACK.max_attempts,
 *    then an SMS with a booking link.
 * With VOICE_PROVIDER unset/simulated no real call is placed (no credit spent).
 */
import { loadRuntimeConfig } from "../config/runtime";
import { db } from "../db/client";
import { sendLoggedSms } from "../handoff/run";
import { alertOps } from "../staff/notify";
import { getVoiceProvider } from "../voice";

interface Due {
  id: string;
  lead_id: string | null;
  purpose: "drop_recovery" | "review_approval";
  attempt_no: number;
  phone: string | null;
  name: string | null;
  callback_window: string | null;
}

export async function runSweep(now = new Date()) {
  const cfg = await loadRuntimeConfig();
  const provider = getVoiceProvider();
  const summary = { placed: 0, retriesScheduled: 0, linksSent: 0, errors: 0 };

  // 1. Retries / fallbacks for approval calls that didn't connect.
  const failed = await db().query<Due>(
    `select a.id, a.lead_id, a.purpose, a.attempt_no, l.phone, l.name, l.callback_window
       from outbound_attempts a join leads l on l.id = a.lead_id
      where a.purpose = 'review_approval' and a.result in ('no_answer','rejected','failed')
        and not exists (select 1 from outbound_attempts b where b.lead_id = a.lead_id and b.purpose = a.purpose and b.attempt_no > a.attempt_no)
        and not exists (select 1 from sms_messages s where s.lead_id = a.lead_id and s.template = 'booking_link')`,
  );
  const maxAttempts = Math.min(cfg.approvalCallback.max_attempts, process.env.VOICE_PROVIDER === "vaani" ? cfg.voiceSpendCap.outbound_attempts : 99);
  for (const f of failed.rows) {
    if (f.attempt_no < maxAttempts) {
      await db().query(
        "insert into outbound_attempts (lead_id, purpose, attempt_no, scheduled_for, result) values ($1,'review_approval',$2,$3,'pending') on conflict do nothing",
        [f.lead_id, f.attempt_no + 1, new Date(now.getTime() + 30 * 60_000)],
      );
      summary.retriesScheduled++;
    } else if (f.phone) {
      const link = `${process.env.APP_BASE_URL ?? `https://${process.env.STUDIO_DOMAIN ?? "example.com"}`}/b/${f.lead_id}`;
      await sendLoggedSms(cfg, f.lead_id, f.phone, "booking_link", [link]);
      summary.linksSent++;
    }
  }

  // 2. Place due calls.
  const due = await db().query<Due>(
    `select a.id, a.lead_id, a.purpose, a.attempt_no,
            coalesce(l.phone, c.caller_phone) as phone, l.name, l.callback_window
       from outbound_attempts a
       left join leads l on l.id = a.lead_id
       left join calls c on c.id = a.source_call_id
      where a.result = 'pending' and a.scheduled_for <= $1
      order by a.scheduled_for limit 10`,
    [now],
  );
  for (const d of due.rows) {
    if (!d.phone || d.phone === "unknown") {
      await db().query("update outbound_attempts set result = 'failed' where id = $1", [d.id]);
      continue;
    }
    try {
      const { providerCallId } = await provider.placeOutboundCall({
        to: d.phone,
        name: d.name ?? "Customer",
        purpose: d.purpose,
        leadId: d.lead_id,
        metadata: { callback_window: d.callback_window ?? "", attempt: String(d.attempt_no) },
      });
      await db().query("update outbound_attempts set provider_call_id = $2, result = $3 where id = $1", [
        d.id,
        providerCallId,
        provider.name === "simulated" ? "simulated" : "placed",
      ]);
      summary.placed++;
    } catch (err) {
      summary.errors++;
      await db().query("update outbound_attempts set result = 'failed' where id = $1", [d.id]);
      await alertOps(`Outbound ${d.purpose} call failed for lead ${d.lead_id}: ${(err as Error).message}`);
    }
  }
  return summary;
}
