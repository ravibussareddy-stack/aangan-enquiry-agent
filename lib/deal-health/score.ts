/**
 * Deal health — estimated likelihood that a qualified / approved lead becomes
 * a won project. Deterministic rubric over fields the call already captured:
 * no LLM, so it costs nothing per lead.
 *
 * 0–100 points across 8 factors (weights below). Bands from DEAL_HEALTH_BANDS
 * config (default High ≥ 70, Medium ≥ 45, else Low). It is an estimate until
 * Won/Lost outcomes come back from HubSpot — the dashboard shows the actual win
 * rate per band so the weights can be tuned.
 *
 * Budget is judged against the internal floor, but only the verdict
 * ("fits scope" / "tight") is shown — never the floor figure.
 */
import type { BudgetGateResult } from "../qualify/budget";
import type { LeadExtraction } from "../schema/lead";

export interface Factor {
  key: string;
  label: string;
  points: number;
  max: number;
  reason: string;
}

export interface DealHealth {
  score: number;
  band: "high" | "medium" | "low";
  factors: Factor[];
}

export interface DealHealthInput {
  extraction: LeadExtraction;
  budget: BudgetGateResult;
  booked: boolean;
  /** Required intake fields still missing (not asked and not answered). */
  missingFields: number;
  /** Weeks from the call to the deadline / site availability (computed by the caller). */
  weeksToDeadline: number | null;
  weeksToSite: number | null;
}

/** The rubric — weights sum to 100. Edit here; `npm run docs:deal-health` regenerates the doc. */
export const RUBRIC = [
  { key: "budget", label: "Budget fits scope", max: 20, levels: "Their budget fits the scope 20 · no budget but comfortable with the typical range 15 · tight 10 · not given 5 · not comfortable with the typical range 2" },
  { key: "timeline", label: "Real, workable timeline", max: 15, levels: "Deadline 6–26 weeks out, or site ready within 10 weeks 15 · no deadline but site ready 10 · further out / vague 5" },
  { key: "decision", label: "Decision-maker on the call", max: 15, levels: "Caller decides or is authorised 15 · calling for someone else 5 · unknown 3" },
  { key: "commitment", label: "Committed next step", max: 15, levels: "Consultation booked 10, +5 if they asked for a site visit" },
  { key: "researched", label: "Has seen our website / work", max: 10, levels: "Yes 10 · unknown 3 · no 0" },
  { key: "referral", label: "Referred to us", max: 10, levels: "Referred by a past client, friend or builder 10 · none 0" },
  { key: "scope", label: "Scope size", max: 10, levels: "Full home / villa / office fit-out 10 · 2+ rooms 7 · single room 4" },
  { key: "completeness", label: "Information captured", max: 5, levels: "Nothing missing 5 · 1–2 fields missing 2 · 3+ missing 0" },
] as const;

const max = (k: string) => RUBRIC.find((r) => r.key === k)!.max;

export function scoreDeal(i: DealHealthInput, bands = { high: 70, medium: 45 }): DealHealth {
  const x = i.extraction;
  const factors: Factor[] = [];
  const add = (key: string, points: number, reason: string) =>
    factors.push({ key, label: RUBRIC.find((r) => r.key === key)!.label, points, max: max(key), reason });

  // Budget
  if (i.budget.status === "pass") add("budget", 20, "Ballpark budget fits the scope");
  else if (i.budget.status === "tight") add("budget", 10, "Budget is tight for the scope");
  else if (x.budget_inr == null && x.typical_budget_reaction === "comfortable") add("budget", 15, "Comfortable with the typical range for the scope");
  else if (x.budget_inr == null && x.typical_budget_reaction === "not_comfortable") add("budget", 2, "Not comfortable with the typical range");
  else add("budget", 5, x.budget_inr == null ? "Budget not shared" : "Budget not comparable to scope yet");

  // Timeline
  const w = i.weeksToDeadline;
  const site = i.weeksToSite;
  if ((w != null && w >= 6 && w <= 26) || (site != null && site <= 10)) add("timeline", 15, w != null ? `Needed in ~${Math.round(w)} weeks` : `Site ready in ~${Math.round(site!)} weeks`);
  else if (w == null && /available|ready|now|possession done|moved/i.test(x.site_state ?? "")) add("timeline", 10, "No deadline, site ready");
  else add("timeline", 5, x.timeline_text ? `Timeline: ${x.timeline_text}` : "No timeline given");

  // Decision-maker
  if (x.decision_maker === "self" || x.decision_maker === "authorised") add("decision", 15, x.decision_maker === "self" ? "Caller decides" : "Authorised by the owner");
  else if (x.decision_maker === "on_behalf_unconfirmed") add("decision", 5, x.decision_maker_note ?? "Calling for someone else");
  else add("decision", 3, "Decision-maker not established");

  // Commitment
  add("commitment", Math.min(15, (i.booked ? 10 : 0) + (x.wants_site_visit ? 5 : 0)), i.booked ? (x.wants_site_visit ? "Booked, site visit requested" : "Consultation booked") : x.wants_site_visit ? "Wants a site visit (not booked yet)" : "Nothing booked yet");

  // Researched
  add("researched", x.researched_us === "yes" ? 10 : x.researched_us === "unknown" ? 3 : 0, x.researched_us === "yes" ? "Has seen our website / work" : x.researched_us === "no" ? "Hasn't seen our work yet" : "Not asked / not said");

  // Referral
  add("referral", x.referral ? 10 : 0, x.referral ? `Referred: ${x.referral}` : "No referral mentioned");

  // Scope
  const scopePts = x.scope_kind === "full_home" || x.scope_kind === "commercial_fitout" ? 10 : x.scope_kind === "partial" ? 7 : x.scope_kind === "single_room" ? 4 : 4;
  add("scope", scopePts, x.scope_text ? x.scope_text.slice(0, 80) : "Scope not described");

  // Completeness
  add("completeness", i.missingFields === 0 ? 5 : i.missingFields <= 2 ? 2 : 0, i.missingFields ? `${i.missingFields} intake field(s) missing` : "Intake complete");

  // Small penalty: a frustrated repeat caller is at risk until someone responds.
  let score = factors.reduce((s, f) => s + f.points, 0);
  if (x.frustrated && x.repeat_caller) {
    score -= 5;
    factors.push({ key: "risk", label: "At risk", points: -5, max: 0, reason: "Frustrated repeat caller — respond quickly" });
  }
  score = Math.max(0, Math.min(100, score));
  const band = score >= bands.high ? "high" : score >= bands.medium ? "medium" : "low";
  return { score, band, factors };
}

export function weeksFrom(callAt: Date, isoDate: string | null): number | null {
  if (!isoDate) return null;
  return (new Date(`${isoDate}T00:00:00+05:30`).getTime() - callAt.getTime()) / (7 * 86_400_000);
}
