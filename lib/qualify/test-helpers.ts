import type { LeadExtraction } from "../schema/lead";

export const CALL_AT = new Date("2026-10-07T10:00:00+05:30");

const pass = (evidence: string) => ({ verdict: "pass" as const, evidence });

/** A clean, qualified residential lead. Override fields per test. */
export function makeLead(overrides: Partial<LeadExtraction> = {}): LeadExtraction {
  return {
    caller_name: "Priya",
    call_intent: "new_enquiry",
    requested_person: null,
    complaint_detected: false,
    unsure_intent: false,
    repeat_caller: false,
    frustrated: false,
    asked_about_price: false,
    project_type: "residential",
    category: "apartment",
    engagement: "design_and_execution",
    structural_work_requested: false,
    scope_kind: "full_home",
    scope_text: "Redo the whole 3BHK — kitchen, living room, both bedrooms",
    rooms_in_scope: null,
    configuration: "3BHK",
    carpet_sqft: 1400,
    site_state: "builder flat",
    locality: "Kothrud",
    pin: null,
    city: "Pune",
    timeline_text: "Done by March",
    completion_by: "2027-03-31",
    site_available_from: null,
    decision_maker: "self",
    decision_maker_note: null,
    budget_inr: null,
    budget_confirmed: false,
    criteria: {
      real_project: pass("We want to redo the whole thing"),
      area: pass("Kothrud"),
      timeline: pass("By March, no rush"),
      budget: { verdict: "unclear", evidence: "" },
      decision_maker: pass("Myself and my husband"),
    },
    in_scope_confidence: 0.92,
    out_of_scope_confidence: 0.03,
    callback_window: null,
    wants_site_visit: false,
    researched_us: "unknown",
    referral: null,
    typical_budget_reaction: "not_asked",
    watch_for: [],
    ...overrides,
  };
}
