/**
 * Recompute and store deal health for one lead (qualified / approved leads only),
 * and mirror the band to HubSpot's deal priority. Called after a call is processed,
 * after a review/callback is approved, and when a booking changes.
 */
import { loadRuntimeConfig } from "../config/runtime";
import { getCrm } from "../crm";
import { db } from "../db/client";
import { intakeFromExtraction } from "../intake/sheet";
import { budgetGate } from "../qualify/budget";
import type { LeadExtraction } from "../schema/lead";
import { scoreDeal, weeksFrom, type DealHealth } from "./score";

export async function computeDealHealth(input: {
  extraction: LeadExtraction;
  callAt: Date;
  booked: boolean;
  notKnown?: string[];
}): Promise<DealHealth> {
  const cfg = await loadRuntimeConfig();
  const missing = intakeFromExtraction(input.extraction, { askBudget: cfg.askBudget, outcome: "qualified", notKnown: input.notKnown }).missing;
  return scoreDeal(
    {
      extraction: input.extraction,
      budget: budgetGate(input.extraction, cfg.qualify),
      booked: input.booked,
      missingFields: missing.length,
      weeksToDeadline: weeksFrom(input.callAt, input.extraction.completion_by),
      weeksToSite: weeksFrom(input.callAt, input.extraction.site_available_from),
    },
    cfg.dealHealthBands,
  );
}

export async function recomputeDealHealth(leadId: string): Promise<DealHealth | null> {
  const { rows } = await db().query<{
    status: string;
    extraction: LeadExtraction;
    started_at: Date;
    booked: boolean;
    hubspot_deal_id: string | null;
    not_known: string[] | null;
  }>(
    `select l.status, l.extraction, c.started_at, l.hubspot_deal_id,
            exists (select 1 from bookings b where b.lead_id = l.id and b.status <> 'cancelled') booked,
            (select array_agg(x) from jsonb_array_elements_text(l.evaluation -> 'intake' -> 'not_known') x) not_known
       from leads l join calls c on c.id = l.call_id where l.id = $1`,
    [leadId],
  );
  const lead = rows[0];
  if (!lead) return null;
  if (lead.status !== "qualified") {
    await db().query("update leads set deal_health_score = null, deal_health_band = null, deal_health_factors = null where id = $1", [leadId]);
    return null;
  }
  const health = await computeDealHealth({ extraction: lead.extraction, callAt: lead.started_at, booked: lead.booked, notKnown: lead.not_known ?? [] });
  await db().query("update leads set deal_health_score = $2, deal_health_band = $3, deal_health_factors = $4 where id = $1", [
    leadId,
    health.score,
    health.band,
    JSON.stringify(health.factors),
  ]);
  if (lead.hubspot_deal_id) await getCrm().setDealPriority(lead.hubspot_deal_id, health.band).catch(() => undefined);
  return health;
}
