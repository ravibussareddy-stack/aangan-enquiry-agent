/**
 * Two-way deal stage sync with the CRM.
 *
 * App → CRM: setLeadDealStage writes the stage and remembers it in
 * leads.hubspot_stage.
 * CRM → app: pullCrmStages reads every linked deal's current stage and applies
 * the ones that differ from hubspot_stage, i.e. changes someone made in
 * HubSpot. Service keys can't send webhooks, so this runs when the dashboard
 * loads (at most once a minute), from the sweep and daily crons, and from
 * Settings → "Sync now". The HubSpot webhook route uses applyCrmStage too.
 */
import { db } from "../db/client";
import { applyReviewDecision, routeLead } from "../review/decide";
import { getCrm } from "./index";
import type { DealStage } from "./types";

/** What a stage set in the CRM means for the lead. Returns what changed, or null. */
export async function applyCrmStage(lead: { id: string; status: string }, stage: DealStage): Promise<string | null> {
  const awaiting = lead.status === "review" || lead.status === "callback";
  if (awaiting && (stage === "New qualified" || stage === "Declined")) {
    const r = await applyReviewDecision({
      leadId: lead.id,
      decision: stage === "New qualified" ? "approved" : "rejected",
      source: "hubspot",
      reviewer: "HubSpot",
      syncCrm: false,
    });
    return r.applied ? (stage === "New qualified" ? "approved" : "rejected") : null;
  }
  // Helpdesk / admins re-route in HubSpot: Service review → designers, Admin review → admin, Callback needed → helpdesk.
  if (awaiting && (stage === "Service review" || stage === "Admin review" || stage === "Callback needed")) {
    const r = await routeLead({ leadId: lead.id, to: stage === "Service review" ? "designer" : stage === "Admin review" ? "admin" : "callback", syncCrm: false });
    return r.applied ? `routed to ${stage}` : null;
  }
  if (stage === "Consultation held" || stage === "Won" || stage === "Lost") {
    const outcome = stage === "Consultation held" ? "held" : stage === "Won" ? "won" : "lost";
    const r = await db().query("update bookings set outcome = $2 where lead_id = $1 and status = 'booked' and outcome is distinct from $2", [lead.id, outcome]);
    return r.rowCount ? `booking ${outcome}` : null;
  }
  return null;
}

/** Move a lead's deal and remember the stage, so the next pull doesn't treat our own write as a HubSpot change. */
export async function setLeadDealStage(dealId: string, stage: DealStage): Promise<void> {
  await getCrm().setDealStage(dealId, stage);
  await db().query("update leads set hubspot_stage = $2 where hubspot_deal_id = $1", [dealId, stage]);
}

export interface PullResult {
  ran: boolean;
  checked: number;
  changes: { leadId: string; stage: DealStage; effect: string | null }[];
  error?: string;
}

/**
 * Pull deal stages from HubSpot. Throttled to once per `minIntervalS` across all
 * instances (an atomic claim on crm_sync_state); `force` skips the throttle.
 */
export async function pullCrmStages(opts: { force?: boolean; minIntervalS?: number } = {}): Promise<PullResult> {
  const crm = getCrm();
  if (crm.provider !== "hubspot") return { ran: false, checked: 0, changes: [] };
  const claim = await db().query(
    `update crm_sync_state set last_run_at = now()
      where provider = 'hubspot' and ($1 or last_run_at is null or last_run_at < now() - make_interval(secs => $2))
      returning provider`,
    [!!opts.force, opts.minIntervalS ?? 60],
  );
  if (!claim.rowCount) return { ran: false, checked: 0, changes: [] };

  const changes: PullResult["changes"] = [];
  try {
    const { rows: leads } = await db().query<{ id: string; status: string; hubspot_deal_id: string; hubspot_stage: string | null }>(
      `select id, status::text, hubspot_deal_id, hubspot_stage from leads
        where hubspot_deal_id is not null and hubspot_deal_id not like 'mock_%'
          and created_at > now() - interval '180 days'`,
    );
    const current = await crm.readDealStages(leads.map((l) => l.hubspot_deal_id));
    for (const lead of leads) {
      const stage = current.get(lead.hubspot_deal_id);
      if (!stage || stage === lead.hubspot_stage) continue;
      const effect = await applyCrmStage(lead, stage);
      await db().query("update leads set hubspot_stage = $2 where id = $1", [lead.id, stage]);
      changes.push({ leadId: lead.id, stage, effect });
    }
    await db().query(
      "update crm_sync_state set last_ok_at = now(), last_error = null, last_checked = $1, last_changes = $2 where provider = 'hubspot'",
      [leads.length, changes.length],
    );
    return { ran: true, checked: leads.length, changes };
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await db().query("update crm_sync_state set last_error = $1 where provider = 'hubspot'", [message]);
    return { ran: true, checked: 0, changes, error: message };
  }
}

/**
 * Dashboard pages call this: a throttled HubSpot pull that runs after the response
 * is sent, so a page never waits on HubSpot (measured ~1.8 s). Changes show on the
 * next page load.
 */
export async function freshFromCrm(): Promise<void> {
  const { after } = await import("next/server");
  after(() => pullCrmStages().then(() => undefined).catch(() => undefined));
}

export async function crmSyncState() {
  const { rows } = await db().query<{ last_run_at: string | null; last_ok_at: string | null; last_error: string | null; last_checked: number; last_changes: number }>(
    "select last_run_at::text, last_ok_at::text, last_error, last_checked, last_changes from crm_sync_state where provider = 'hubspot'",
  );
  return rows[0] ?? null;
}
