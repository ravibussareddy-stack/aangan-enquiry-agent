import type { LeadFacts } from "../../agent/tools";
import type { CriterionAssessment, LeadExtraction } from "../schema/lead";

const UNCLEAR: CriterionAssessment = { verdict: "unclear", evidence: "" };

function plusWeeks(startIso: string | undefined, weeks: number | undefined): string | null {
  if (weeks == null || !startIso) return null;
  const d = new Date(new Date(startIso).getTime() + weeks * 7 * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

/** Fill a partial in-call fact sheet into a full LeadExtraction for evaluateLead. */
export function factsToExtraction(f: LeadFacts, callStartedAt?: string): LeadExtraction {
  return {
    caller_name: f.caller_name ?? null,
    call_intent: f.call_intent ?? "new_enquiry",
    requested_person: f.requested_person ?? null,
    complaint_detected: f.complaint_detected ?? false,
    unsure_intent: f.unsure_intent ?? false,
    repeat_caller: f.repeat_caller ?? false,
    frustrated: f.frustrated ?? false,
    asked_about_price: f.asked_about_price ?? false,
    project_type: f.project_type ?? "unknown",
    category: f.category ?? "unknown",
    engagement: f.engagement ?? "unknown",
    structural_work_requested: f.structural_work_requested ?? false,
    scope_kind: f.scope_kind ?? "unknown",
    scope_text: f.scope_text ?? "",
    rooms_in_scope: f.rooms_in_scope ?? null,
    configuration: f.configuration ?? null,
    carpet_sqft: f.carpet_sqft ?? null,
    site_state: f.site_state ?? null,
    locality: f.locality ?? null,
    pin: f.pin ?? null,
    city: f.city ?? null,
    timeline_text: f.timeline_text ?? null,
    completion_by: plusWeeks(callStartedAt, f.completion_in_weeks),
    site_available_from: plusWeeks(callStartedAt, f.site_available_in_weeks),
    decision_maker: f.decision_maker ?? "unknown",
    decision_maker_note: f.decision_maker_note ?? null,
    budget_inr: f.budget_inr ?? null,
    budget_confirmed: f.budget_confirmed ?? false,
    criteria: {
      real_project: f.criteria?.real_project ?? UNCLEAR,
      area: f.criteria?.area ?? UNCLEAR,
      timeline: f.criteria?.timeline ?? UNCLEAR,
      budget: f.criteria?.budget ?? UNCLEAR,
      decision_maker: f.criteria?.decision_maker ?? UNCLEAR,
    },
    in_scope_confidence: f.in_scope_confidence ?? 0.5,
    out_of_scope_confidence: f.out_of_scope_confidence ?? 0.1,
    callback_window: f.callback_window ?? null,
    wants_site_visit: f.wants_site_visit ?? false,
    researched_us: f.researched_us ?? "unknown",
    referral: f.referral ?? null,
    typical_budget_reaction: f.typical_budget_reaction ?? "not_asked",
    watch_for: f.watch_for ?? [],
  };
}
