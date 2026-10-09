/**
 * Review decisions (Telegram buttons, HubSpot stage change, or dashboard).
 * Approve → schedule the outbound booking call(s). Reject → founder-approved SMS close.
 * The first decision wins (one review per lead).
 */
import { loadRuntimeConfig } from "../config/runtime";
import { setLeadDealStage } from "../crm/stage-sync";
import { db } from "../db/client";
import { sendLoggedSms } from "../handoff/run";

export type ReviewOutcome = "approved" | "rejected";

export async function applyReviewDecision(opts: {
  leadId: string;
  decision: ReviewOutcome;
  source: "telegram" | "hubspot" | "dashboard";
  reviewer: string;
  reviewerDesignerId?: string | null;
  syncCrm?: boolean;
}): Promise<{ applied: boolean; reason?: string }> {
  const cfg = await loadRuntimeConfig();
  const client = await db().connect();
  let lead: { phone: string; hubspot_deal_id: string | null; name: string | null } | undefined;
  try {
    await client.query("begin");
    const res = await client.query<{ phone: string; status: string; hubspot_deal_id: string | null; name: string | null }>(
      "select phone, status, hubspot_deal_id, name from leads where id = $1 for update",
      [opts.leadId],
    );
    const row = res.rows[0];
    if (!row) return { applied: false, reason: "Lead not found" };
    if (row.status !== "review" && row.status !== "callback") return { applied: false, reason: `Lead is ${row.status}, not awaiting a decision` };
    const inserted = await client.query(
      `insert into reviews (lead_id, reviewer, reviewer_designer_id, decision, source) values ($1,$2,$3,$4,$5)
       on conflict (lead_id) do nothing returning id`,
      [opts.leadId, opts.reviewer, opts.reviewerDesignerId ?? null, opts.decision, opts.source],
    );
    if (!inserted.rowCount) {
      await client.query("rollback");
      return { applied: false, reason: "Already decided" };
    }
    if (opts.decision === "approved") {
      await client.query("update leads set status = 'qualified', flags = array_append(flags, 'approved_after_review') where id = $1", [opts.leadId]);
      await client.query(
        `insert into outbound_attempts (lead_id, purpose, attempt_no, scheduled_for, result)
         values ($1, 'review_approval', 1, now(), 'pending') on conflict do nothing`,
        [opts.leadId],
      );
    } else {
      await client.query("update leads set status = 'declined', decline_reason = 'review_rejected' where id = $1", [opts.leadId]);
    }
    await client.query("commit");
    lead = row;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  if (opts.syncCrm !== false && lead.hubspot_deal_id) {
    await setLeadDealStage(lead.hubspot_deal_id, opts.decision === "approved" ? "New qualified" : "Declined").catch(() => undefined);
  }
  if (opts.decision === "rejected") {
    await sendLoggedSms(cfg, opts.leadId, lead.phone, "review_reject", []);
  } else {
    const { recomputeDealHealth } = await import("../deal-health/store");
    await recomputeDealHealth(opts.leadId);
  }
  return { applied: true };
}

/**
 * Route a callback / review lead to a review queue ("Service review" = designers,
 * "Admin review" = founder/admin), or mark it "Callback needed" for the helpdesk.
 * Used by Telegram buttons, the HubSpot stage webhook and the dashboard.
 */
export async function routeLead(opts: {
  leadId: string;
  to: "designer" | "admin" | "callback";
  syncCrm?: boolean;
}): Promise<{ applied: boolean; reason?: string }> {
  const { rows } = await db().query<{ status: string; hubspot_deal_id: string | null }>(
    `update leads set
        status = $2::lead_status,
        review_queue = case when $3::text is null then review_queue else $3::text end
      where id = $1 and status in ('review', 'callback')
      returning status, hubspot_deal_id`,
    [opts.leadId, opts.to === "callback" ? "callback" : "review", opts.to === "callback" ? null : opts.to],
  );
  if (!rows[0]) return { applied: false, reason: "Lead is not awaiting a decision" };
  if (opts.syncCrm !== false && rows[0].hubspot_deal_id) {
    const stage = opts.to === "admin" ? "Admin review" : opts.to === "designer" ? "Service review" : "Callback needed";
    await setLeadDealStage(rows[0].hubspot_deal_id, stage).catch(() => undefined);
  }
  return { applied: true };
}
