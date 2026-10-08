/**
 * The intake sheet — every field a phone enquiry must capture before a
 * designer sees it. Single source for:
 *   - the agent (server returns the next question to ask),
 *   - evaluate_lead gating (no decision while required fields are unasked),
 *   - the designer note and dashboard ("Missing: …"),
 *   - docs/intake-sheet.md (generated: npm run docs:intake).
 *
 * Callers don't always volunteer details, so the agent asks for each field.
 * A field the caller can't or won't answer is recorded as "not known" and
 * counts as asked — the agent moves on rather than pushing.
 */
import type { LeadFacts } from "../../agent/tools";
import type { LeadExtraction } from "../schema/lead";

export type Requirement = "always" | "if_ask_budget" | "if_review_or_redirect" | "optional";

export interface IntakeField {
  key: string;
  label: string;
  /** Natural question the agent can ask (it may rephrase or combine two). */
  question: string;
  requirement: Requirement;
  /** Which rubric criterion this feeds, if any. */
  criterion?: "real_project" | "area" | "timeline" | "budget" | "decision_maker";
  why: string;
  /** Captured during the call (from the agent's facts). */
  inCall: (f: LeadFacts) => boolean;
  /** Captured in the stored post-call extraction. */
  postCall: (x: LeadExtraction) => boolean;
}

export const INTAKE_FIELDS: IntakeField[] = [
  {
    key: "caller_name",
    label: "Caller name",
    question: "May I have your name, please?",
    requirement: "always",
    why: "Booking, SMS confirmation and the designer's first call.",
    inCall: (f) => !!f.caller_name,
    postCall: (x) => !!x.caller_name,
  },
  {
    key: "intent",
    label: "Why they're calling",
    question: "What can I help you with today — a new project, something about an existing project, or reaching a particular designer?",
    requirement: "always",
    why: "Routes the call: new enquiries go through this sheet; existing-project issues get a senior callback; updates and named-designer requests become a message; anything else goes to the helpdesk.",
    inCall: (f) => !!f.call_intent,
    postCall: () => true,
  },
  {
    key: "what_work",
    label: "What they want done",
    question: "What would you like done — which rooms or areas, and are you looking for full design and execution?",
    requirement: "always",
    criterion: "real_project",
    why: "Criterion 1 (real project) and the excluded-engagement rule (advice-only, decor-only, Vastu-only, structural).",
    inCall: (f) => !!f.scope_text && !!f.engagement && f.engagement !== "unknown",
    postCall: (x) => !!x.scope_text && x.engagement !== "unknown",
  },
  {
    key: "space_type",
    label: "Type of space",
    question: "Is this for a home, or an office, clinic or studio?",
    requirement: "always",
    why: "Residential vs commercial rules; excluded categories (restaurant, hotel, retail, gym).",
    inCall: (f) => !!f.project_type && f.project_type !== "unknown",
    postCall: (x) => x.project_type !== "unknown",
  },
  {
    key: "locality",
    label: "Locality",
    question: "Which area is it in — so we can confirm we cover it and match you with a nearby designer?",
    requirement: "always",
    criterion: "area",
    why: "Criterion 2 (service area: Pune city + PCMC).",
    inCall: (f) => !!f.locality || !!f.city,
    postCall: (x) => !!x.locality || !!x.city,
  },
  {
    key: "pin",
    label: "PIN code",
    question: "And the PIN code?",
    requirement: "always",
    criterion: "area",
    why: "Confirms the service area when the locality name is ambiguous or unfamiliar.",
    inCall: (f) => !!f.pin,
    postCall: (x) => !!x.pin,
  },
  {
    key: "size",
    label: "Size of the area to be done",
    question: "Roughly how big is the area we'd be working on — its carpet area, or how many rooms?",
    requirement: "always",
    why: "Commercial size limits; scope for the designer.",
    // A whole home or office needs its carpet area (or at least the configuration); rooms are enough for partial jobs.
    inCall: (f) =>
      f.carpet_sqft != null || (f.scope_kind === "full_home" ? !!f.configuration : f.rooms_in_scope != null || !!f.configuration),
    postCall: (x) =>
      x.carpet_sqft != null || (x.scope_kind === "full_home" ? !!x.configuration : x.rooms_in_scope != null || !!x.configuration),
  },
  {
    key: "site_ready",
    label: "Site status / possession",
    question: "Is the site available to work on now, or are you waiting for possession?",
    requirement: "always",
    criterion: "timeline",
    why: "Criterion 3: the site must be available for execution within 8–10 weeks.",
    inCall: (f) => f.site_available_in_weeks != null || !!f.site_state,
    postCall: (x) => x.site_available_from != null || !!x.site_state,
  },
  {
    key: "deadline",
    label: "When it must be complete",
    question: "When would you need the project complete?",
    requirement: "always",
    criterion: "timeline",
    why: "Criterion 3 and the 6-week minimum lead time. \"No fixed deadline\" is a valid answer.",
    inCall: (f) => f.completion_in_weeks != null || !!f.timeline_text,
    postCall: (x) => x.completion_by != null || !!x.timeline_text,
  },
  {
    key: "decision_maker",
    label: "Decision-maker",
    question: "Will you be the one deciding on this, or is someone else involved?",
    requirement: "always",
    criterion: "decision_maker",
    why: "Criterion 5. Never pushed — an unclear answer is flagged for the designer.",
    inCall: (f) => !!f.decision_maker && f.decision_maker !== "unknown",
    postCall: (x) => x.decision_maker !== "unknown",
  },
  {
    key: "budget",
    label: "Ballpark budget",
    question: "Do you have a ballpark budget in mind for this?",
    requirement: "if_ask_budget",
    criterion: "budget",
    why: "Criterion 4 and deal health. Repeated back to confirm (speech recognition confuses 1.5 and 15 lakh). Asked on every call while ASK_BUDGET is on; a refusal is accepted.",
    inCall: (f) => f.budget_inr != null,
    postCall: (x) => x.budget_inr != null,
  },
  {
    key: "researched",
    label: "Seen our website / work",
    question: "Have you had a chance to look at our website or any of our past work?",
    requirement: "always",
    why: "Deal health: callers who've already looked at the studio's work convert better. Any referral mentioned is noted too.",
    inCall: (f) => !!f.researched_us && f.researched_us !== "unknown",
    postCall: (x) => x.researched_us !== "unknown",
  },
  {
    key: "callback_window",
    label: "General free times",
    question: "When are you generally free to take a call?",
    requirement: "if_review_or_redirect",
    why: "Review, callback and redirect leads get a call back as soon as possible — no time is promised; the caller's usual free times help the team reach them. Must come from the caller.",
    inCall: (f) => !!f.callback_window,
    postCall: (x) => !!x.callback_window,
  },
  {
    key: "site_visit",
    label: "Site visit wanted",
    question: "Would you like the first consultation at your site?",
    requirement: "optional",
    why: "Chooses the site-visit event type when booking.",
    inCall: (f) => f.wants_site_visit != null,
    postCall: () => true,
  },
];

export const INTAKE_KEYS = INTAKE_FIELDS.map((f) => f.key);

function applies(field: IntakeField, opts: { askBudget: boolean; outcome?: string | null }) {
  switch (field.requirement) {
    case "always":
      return true;
    case "if_ask_budget":
      return opts.askBudget;
    case "if_review_or_redirect":
      return opts.outcome === "review" || opts.outcome === "redirect";
    case "optional":
      return false;
  }
}

export interface IntakeStatus {
  captured: string[];
  notKnown: string[];
  /** Required fields neither captured nor marked not-known. */
  missing: string[];
  next: IntakeField | null;
}

/** In-call status: what's still to ask. */
export function intakeStatus(facts: LeadFacts & { not_known?: string[] }, opts: { askBudget: boolean; outcome?: string | null }): IntakeStatus {
  const notKnown = new Set(facts.not_known ?? []);
  const captured: string[] = [];
  const missing: string[] = [];
  for (const field of INTAKE_FIELDS) {
    if (field.inCall(facts)) captured.push(field.key);
    else if (applies(field, opts) && !notKnown.has(field.key)) missing.push(field.key);
  }
  const next = INTAKE_FIELDS.find((f) => f.key === missing[0]) ?? null;
  return { captured, notKnown: [...notKnown], missing, next };
}

/**
 * Post-call status from the stored extraction (for the designer note and dashboard).
 * Fields the caller was asked but couldn't answer (notKnown) don't count as missing.
 */
export function intakeFromExtraction(x: LeadExtraction, opts: { askBudget: boolean; outcome?: string | null; notKnown?: string[] }) {
  const notKnown = new Set(opts.notKnown ?? []);
  const missing = INTAKE_FIELDS.filter((f) => applies(f, opts) && !f.postCall(x) && !notKnown.has(f.key)).map((f) => f.key);
  return { missing, missingLabels: missing.map((k) => INTAKE_FIELDS.find((f) => f.key === k)!.label) };
}

export function labelFor(key: string) {
  return INTAKE_FIELDS.find((f) => f.key === key)?.label ?? key;
}

/** Map loose field names the model uses onto intake keys. */
const ALIASES: Record<string, string> = {
  name: "caller_name",
  call_intent: "intent",
  purpose: "intent",
  scope: "what_work",
  scope_text: "what_work",
  engagement: "what_work",
  project_type: "space_type",
  category: "space_type",
  city: "locality",
  pin_code: "pin",
  pincode: "pin",
  carpet_sqft: "size",
  carpet_area: "size",
  rooms_in_scope: "size",
  configuration: "size",
  site_state: "site_ready",
  site_available_in_weeks: "site_ready",
  possession: "site_ready",
  timeline: "deadline",
  timeline_text: "deadline",
  completion_in_weeks: "deadline",
  budget_inr: "budget",
  researched_us: "researched",
  website: "researched",
};

/**
 * Accept "caller didn't know" only for real intake keys the server actually
 * prompted the agent to ask — the agent can't mark a field unknown to skip it.
 */
export function sanitizeNotKnown(raw: string[] | undefined, prompted: string[]): string[] {
  const keys = (raw ?? []).map((k) => ALIASES[k] ?? k).filter((k) => INTAKE_KEYS.includes(k) && prompted.includes(k));
  return [...new Set(keys)];
}
