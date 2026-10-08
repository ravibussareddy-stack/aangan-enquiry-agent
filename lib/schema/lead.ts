/**
 * Lead extraction schema — the one contract shared by:
 *  - the voice agent's in-call tools (`check_scope`, `evaluate_lead`),
 *  - post-call extraction from the full transcript (the stored version),
 *  - the server-side qualification library (`lib/qualify`),
 *  - the eval harness.
 *
 * Channel-agnostic: nothing here is specific to Vaani or to phone calls.
 * Criterion definitions mirror seed/qualified.md (the founder's rubric).
 */
import { z } from "zod";

export const Verdict = z.enum(["pass", "fail", "unclear"]);
export type Verdict = z.infer<typeof Verdict>;

export const CRITERIA = [
  "real_project",
  "area",
  "timeline",
  "budget",
  "decision_maker",
] as const;
export const CriterionKey = z.enum(CRITERIA);
export type CriterionKey = z.infer<typeof CriterionKey>;

export const CriterionAssessment = z.object({
  verdict: Verdict,
  /** Short quote from the transcript supporting the verdict. Empty if nothing was said. */
  evidence: z.string().max(280),
});
export type CriterionAssessment = z.infer<typeof CriterionAssessment>;

export const ProjectType = z.enum(["residential", "commercial", "unknown"]);

export const Category = z.enum([
  "apartment",
  "independent_house",
  "villa",
  "office",
  "clinic",
  "studio",
  "coworking",
  "restaurant",
  "cafe",
  "hotel",
  "retail",
  "gym",
  "other",
  "unknown",
]);
export type Category = z.infer<typeof Category>;

export const Engagement = z.enum([
  /** Design + execution — the only engagement Aangan takes on. */
  "design_and_execution",
  "advice_only",
  "decor_only",
  "furniture_sourcing_only",
  "vastu_only",
  /** "I'll do the execution myself." */
  "self_execution",
  /** Moving walls, structural modifications, permits. */
  "structural",
  "unknown",
]);
export type Engagement = z.infer<typeof Engagement>;

export const ScopeKind = z.enum([
  "full_home",
  /** A full floor, or 2+ rooms with execution. */
  "partial",
  "single_room",
  "commercial_fitout",
  "unknown",
]);
export type ScopeKind = z.infer<typeof ScopeKind>;

export const DecisionMaker = z.enum([
  /** Caller is the owner / decides. */
  "self",
  /** Calling on behalf of the decider, and confirms they are authorised to go ahead. */
  "authorised",
  /** Decider will attend / decide later; caller is researching for them. */
  "on_behalf_unconfirmed",
  "unknown",
]);

const IsoDate = z.iso.date();
const Pin = z.string().regex(/^\d{6}$/);

export const LeadExtraction = z.object({
  caller_name: z.string().nullable(),

  // --- Why they called -------------------------------------------------------
  /** new_enquiry = a new project; existing_project_issue = problem/complaint with an ongoing Aangan project;
   *  existing_project_update = status question / message about an ongoing project; specific_designer = wants a
   *  named person; other = vendor, job seeker, sales, wrong number… */
  call_intent: z.enum(["new_enquiry", "existing_project_issue", "existing_project_update", "specific_designer", "other"]),
  /** Person the caller asked for by name, if any. */
  requested_person: z.string().nullable(),

  // --- Routing signals -----------------------------------------------------
  /** Existing Aangan client raising a problem with an ongoing/past project. */
  complaint_detected: z.boolean().describe(
    "True ONLY for an existing Aangan client complaining about their own ongoing/past Aangan project. A new caller annoyed about a missed callback is frustrated/repeat_caller, not a complaint.",
  ),
  /** Caller is unsure WHETHER they want a project at all ("just exploring"). Not: unsure about style/materials. */
  unsure_intent: z.boolean(),
  /** Caller says they called before and nobody followed up. */
  repeat_caller: z.boolean(),
  /** Caller sounds frustrated or upset. */
  frustrated: z.boolean(),
  asked_about_price: z.boolean(),

  // --- Project ---------------------------------------------------------------
  project_type: ProjectType,
  category: Category,
  engagement: Engagement,
  structural_work_requested: z.boolean(),
  scope_kind: ScopeKind,
  /** Caller's own description of what they want done. */
  scope_text: z.string(),
  /** Rooms in scope (kitchen counts as a room). Null if whole home or not stated. */
  rooms_in_scope: z.number().int().min(0).nullable(),
  /** Home configuration if stated, e.g. "3BHK". */
  configuration: z.string().nullable(),
  /** Carpet area in sq ft as stated (usually the whole unit). */
  carpet_sqft: z.number().positive().nullable(),
  /** Current state of the site, e.g. "bare shell", "builder flat", "lived in 5 years". */
  site_state: z.string().nullable(),

  // --- Location ----------------------------------------------------------------
  locality: z.string().nullable(),
  pin: Pin.nullable(),
  city: z.string().nullable(),

  // --- Timeline (dates resolved relative to the call date, Asia/Kolkata) ----
  timeline_text: z.string().nullable(),
  /** Date the project must be COMPLETE by, if the caller has a deadline. Month-only → last day of month. */
  completion_by: IsoDate.nullable().describe(
    "Date the finished project is NEEDED BY (move-in, guests, opening). NOT the possession/handover date. Null if no deadline.",
  ),
  /** Earliest date the site can be handed over for execution (possession date etc.). Null = available now / not stated. */
  site_available_from: IsoDate.nullable().describe(
    "Date the site can first be worked on (possession/handover). Null if available now or not stated.",
  ),

  // --- Decision maker & budget ---------------------------------------------------
  decision_maker: DecisionMaker,
  decision_maker_note: z.string().nullable(),
  /** Budget in rupees. For a range, use the UPPER bound. Null if not given. */
  budget_inr: z.number().positive().nullable(),
  /** True only if the figure was repeated back to the caller and confirmed (STT confuses 1.5 vs 15 lakh). */
  budget_confirmed: z.boolean(),

  // --- Intent signals (feed deal health) ---------------------------------------------
  /** Has the caller looked at Aangan's website, Instagram or past work? */
  researched_us: z.enum(["yes", "no", "unknown"]),
  /** Who/what referred them, if mentioned (past client, builder, friend…). Null if none. */
  referral: z.string().nullable(),
  /** Reaction to the typical budget range the agent shared (only shared when the caller gave no budget). */
  typical_budget_reaction: z.enum(["comfortable", "not_comfortable", "unsure", "not_asked"]),

  // --- Agent's assessment ----------------------------------------------------------
  criteria: z.object({
    real_project: CriterionAssessment,
    area: CriterionAssessment,
    timeline: CriterionAssessment,
    budget: CriterionAssessment,
    decision_maker: CriterionAssessment,
  }),
  in_scope_confidence: z.number().min(0).max(1),
  out_of_scope_confidence: z.number().min(0).max(1),

  // --- Handoff extras --------------------------------------------------------------
  /** Preferred callback window, if the caller gave one (review/redirect paths). */
  callback_window: z.string().nullable(),
  /** Site visit requested for the first consultation. */
  wants_site_visit: z.boolean(),
  /** Short notes for the designer: uncertainties, repeat caller, frustration. */
  watch_for: z.array(z.string()),
});
export type LeadExtraction = z.infer<typeof LeadExtraction>;

export const LeadOutcome = z.enum([
  "qualified",
  "review",
  "declined",
  "redirect",
  "complaint",
]);
export type LeadOutcome = z.infer<typeof LeadOutcome>;

export const DeclineReason = z.enum([
  "area",
  "category",
  "engagement",
  "commercial_size",
  "timeline",
  "budget",
  "out_of_scope",
  "multiple_criteria",
]);
export type DeclineReason = z.infer<typeof DeclineReason>;

/** JSON Schema for LLM structured output (Gemini `responseJsonSchema`, Vaani BYOL, etc.). */
export function leadExtractionJsonSchema() {
  return z.toJSONSchema(LeadExtraction, { target: "draft-7" });
}
