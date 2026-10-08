/**
 * Information-sufficiency routing, layered on top of evaluateLead.
 * Qualification (evaluateLead) says whether the project fits; this says whether
 * we captured enough to act. If too many core intake fields are missing and
 * nothing was booked, the lead goes to the helpdesk as "Callback needed".
 */
import type { LeadOutcome } from "../schema/lead";

export type LeadStatus = LeadOutcome | "callback";

export interface RoutingInput {
  outcome: LeadOutcome;
  /** Intake fields still missing (not asked, not answered). */
  missing: string[];
  booked: boolean;
  rule: { min_missing_core: number; core_fields: string[] };
}

export function routeForInfo(i: RoutingInput): { status: LeadStatus; missingCore: string[] } {
  const missingCore = i.missing.filter((k) => i.rule.core_fields.includes(k));
  const decidable = i.outcome === "qualified" || i.outcome === "review";
  const insufficient = decidable && !i.booked && missingCore.length >= i.rule.min_missing_core;
  return { status: insufficient ? "callback" : i.outcome, missingCore };
}
