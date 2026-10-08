/**
 * Hand-written labels for the eval cases: the expected outcome, plus a
 * "golden" extraction — what a correct post-call extraction of the transcript
 * should produce. Applied to eval/cases/*.json by `npm run eval:label`.
 *
 * Fixture mode (Phase 2) runs evaluate_lead on these goldens: it tests the
 * decision logic, not the LLM. LLM mode (Phase 3) extracts from the
 * transcript and compares against the same expected outcome.
 *
 * LABELS NEED FOUNDER APPROVAL — see eval/LABELS.md.
 */
import type { LeadExtraction, LeadOutcome, DeclineReason, CriterionAssessment } from "../lib/schema/lead";
import type { LeadFlag } from "../lib/qualify/evaluate";

export interface Expected {
  outcome: LeadOutcome | null;
  decline_reason?: DeclineReason;
  /** Documented ambiguities only: other outcomes that are safe and accepted (LLM mode). */
  acceptable?: LeadOutcome[];
  flags_include?: LeadFlag[];
  /** Excluded cases have no content to evaluate. */
  excluded?: string;
  note?: string;
}

export interface Label {
  expected: Expected;
  fixture: LeadExtraction | null;
}

export interface SyntheticCase extends Label {
  id: string;
  adapted_from: string;
  call_started_at: string;
  transcript: { speaker: "agent" | "caller"; text: string }[];
}

const P = (evidence: string): CriterionAssessment => ({ verdict: "pass", evidence });
const F = (evidence: string): CriterionAssessment => ({ verdict: "fail", evidence });
const U = (evidence = ""): CriterionAssessment => ({ verdict: "unclear", evidence });

/** Neutral starting point: nothing known yet. */
function lead(o: Partial<LeadExtraction>): LeadExtraction {
  return {
    caller_name: null,
    call_intent: "new_enquiry",
    requested_person: null,
    complaint_detected: false,
    unsure_intent: false,
    repeat_caller: false,
    frustrated: false,
    asked_about_price: false,
    project_type: "unknown",
    category: "unknown",
    engagement: "unknown",
    structural_work_requested: false,
    scope_kind: "unknown",
    scope_text: "",
    rooms_in_scope: null,
    configuration: null,
    carpet_sqft: null,
    site_state: null,
    locality: null,
    pin: null,
    city: null,
    timeline_text: null,
    completion_by: null,
    site_available_from: null,
    decision_maker: "unknown",
    decision_maker_note: null,
    budget_inr: null,
    budget_confirmed: false,
    criteria: {
      real_project: U(),
      area: U(),
      timeline: U(),
      budget: U("Budget not mentioned"),
      decision_maker: U(),
    },
    in_scope_confidence: 0.5,
    out_of_scope_confidence: 0.1,
    callback_window: null,
    wants_site_visit: false,
    researched_us: "unknown",
    referral: null,
    typical_budget_reaction: "not_asked",
    watch_for: [],
    ...o,
  };
}

const home = { project_type: "residential", category: "apartment", engagement: "design_and_execution" } as const;

export const LABELS: Record<string, Label> = {
  T01: {
    expected: { outcome: "qualified" },
    fixture: lead({
      ...home,
      caller_name: "Priya",
      scope_kind: "full_home",
      scope_text: "Redo the whole flat — kitchen, living room, both bedrooms",
      configuration: "3BHK",
      carpet_sqft: 1400,
      site_state: "Builder flat, bought two years ago",
      locality: "Kothrud — Dahanukar Colony",
      timeline_text: "Done by March, no rush",
      completion_by: "2027-03-31",
      decision_maker: "self",
      decision_maker_note: "Owner with husband, who is happy to go ahead",
      criteria: {
        real_project: P("We want to redo the whole thing"),
        area: P("3BHK in Kothrud — Dahanukar Colony"),
        timeline: P("We'd like to be done by March. We're in no rush."),
        budget: U("Budget not mentioned"),
        decision_maker: P("Yes — myself and my husband. He knows we're calling"),
      },
      in_scope_confidence: 0.95,
      out_of_scope_confidence: 0.02,
      watch_for: ["Referred by Shruti Joshi (past client, Aundh)"],
    }),
  },

  T02: {
    expected: { outcome: "qualified", flags_include: ["asked_about_price", "decision_maker_unclear"] },
    fixture: lead({
      ...home,
      asked_about_price: true,
      scope_kind: "full_home",
      scope_text: "Full redesign — modular kitchen, wardrobes, living room, both bedrooms",
      configuration: "2BHK",
      carpet_sqft: 950,
      locality: "Wakad",
      timeline_text: "Moving in November; design from October",
      completion_by: "2026-11-30",
      criteria: {
        real_project: P("Full redesign — modular kitchen, wardrobes, living room, both bedrooms"),
        area: P("2BHK in Wakad"),
        timeline: P("We move in November — so maybe starting design from October?"),
        budget: U("Budget not mentioned; asked for a ballpark twice"),
        decision_maker: U("Not asked"),
      },
      in_scope_confidence: 0.88,
      out_of_scope_confidence: 0.03,
      watch_for: ["Pushed twice for a price range", "Tight move-in date (November)"],
    }),
  },

  T03: {
    expected: { outcome: "declined", decline_reason: "area" },
    fixture: lead({
      ...home,
      caller_name: "Suresh Patil",
      scope_kind: "partial",
      scope_text: "Redo home office and study",
      rooms_in_scope: 2,
      locality: "Nashik",
      city: "Nashik",
      criteria: {
        real_project: P("I want to redo my home office and study"),
        area: F("I'm in Nashik"),
        timeline: U(),
        budget: U("Budget not mentioned"),
        decision_maker: U(),
      },
      in_scope_confidence: 0.1,
      out_of_scope_confidence: 0.95,
    }),
  },

  T04: {
    expected: { outcome: "declined", decline_reason: "engagement", note: "Advice-only hard rule wins over 'just exploring' (redirect)" },
    fixture: lead({
      project_type: "residential",
      category: "apartment",
      engagement: "advice_only",
      unsure_intent: true,
      scope_kind: "single_room",
      scope_text: "Ideas for the living room — colours, furniture arrangement",
      criteria: {
        real_project: F("Just want suggestions on colours, furniture arrangement"),
        area: U(),
        timeline: U(),
        budget: U("Budget not mentioned"),
        decision_maker: U(),
      },
      in_scope_confidence: 0.05,
      out_of_scope_confidence: 0.9,
    }),
  },

  T05: {
    expected: { outcome: "qualified", flags_include: ["decision_maker_unclear", "site_visit_requested"] },
    fixture: lead({
      ...home,
      caller_name: "Aarti Mehta",
      scope_kind: "full_home",
      scope_text: "Complete redesign — new flooring, kitchen, all four bedrooms",
      configuration: "4BHK",
      carpet_sqft: 2400,
      site_state: "Family has moved out temporarily",
      locality: "Koregaon Park",
      timeline_text: "Move back in by February (about 4 months)",
      completion_by: "2027-02-28",
      wants_site_visit: true,
      criteria: {
        real_project: P("Complete redesign. New flooring, kitchen, all four bedrooms"),
        area: P("4BHK in Koregaon Park"),
        timeline: P("We want to move back in by February"),
        budget: U("Budget not mentioned"),
        decision_maker: U("Not asked; referred by Vikram Agarwal"),
      },
      in_scope_confidence: 0.94,
      out_of_scope_confidence: 0.02,
      watch_for: ["Referral from Vikram Agarwal, a friend of Nikhil's", "Wants a site visit"],
    }),
  },

  T06: {
    expected: { outcome: "qualified" },
    fixture: lead({
      project_type: "commercial",
      category: "office",
      engagement: "design_and_execution",
      scope_kind: "commercial_fitout",
      scope_text: "Workstations for 20, a small cabin, meeting room, break area",
      carpet_sqft: 800,
      site_state: "Bare shell",
      locality: "Baner",
      timeline_text: "Operational by December",
      completion_by: "2026-12-31",
      decision_maker: "self",
      decision_maker_note: "Founder",
      criteria: {
        real_project: P("Full fitout from scratch"),
        area: P("Office space in Baner"),
        timeline: P("We want to be operational by December"),
        budget: U("Budget not mentioned"),
        decision_maker: P("Yes, I'm the founder"),
      },
      in_scope_confidence: 0.92,
      out_of_scope_confidence: 0.03,
    }),
  },

  T07: {
    expected: {
      outcome: "declined",
      decline_reason: "timeline",
      acceptable: ["review", "redirect"],
      note: "Front desk said Diwali was ~3 weeks away; Diwali 2026 is actually 8 Nov (~9 weeks from 8 Sep). Labelled on the transcript as recorded.",
    },
    fixture: lead({
      ...home,
      scope_kind: "partial",
      scope_text: "Redo living room and kitchen",
      rooms_in_scope: 2,
      timeline_text: "Before Diwali (about three weeks away)",
      completion_by: "2026-09-29",
      criteria: {
        real_project: P("I want to redo my living room and kitchen"),
        area: U("Location not given"),
        timeline: F("Before Diwali — about three weeks away"),
        budget: U("Budget not mentioned"),
        decision_maker: U(),
      },
      in_scope_confidence: 0.3,
      out_of_scope_confidence: 0.6,
      watch_for: ["Might come back for a November start"],
    }),
  },

  T08: {
    expected: { outcome: null, excluded: "Missed call, no content (after hours, 10:47pm). Covered by the 11pm live test instead." },
    fixture: null,
  },

  T09: {
    expected: { outcome: "complaint" },
    fixture: lead({
      ...home,
      caller_name: "Sheetal Deshpande",
      call_intent: "existing_project_issue",
      complaint_detected: true,
      frustrated: true,
      scope_text: "Ongoing project; designer Aryan hasn't replied in five days",
      configuration: "2BHK",
      locality: "Viman Nagar",
      in_scope_confidence: 0.5,
      out_of_scope_confidence: 0.1,
      callback_window: "Within 15 minutes, from Nikhil or a senior person",
      watch_for: ["Existing client — designer Aryan", "Wants callback from Nikhil or a senior person"],
    }),
  },

  T10: {
    expected: { outcome: "declined", decline_reason: "budget" },
    fixture: lead({
      ...home,
      scope_kind: "partial",
      scope_text: "Kitchen and one bedroom",
      rooms_in_scope: 2,
      configuration: "1BHK",
      carpet_sqft: 550,
      locality: "Kharadi",
      budget_inr: 150000,
      budget_confirmed: true,
      criteria: {
        real_project: P("I want to do the kitchen and one bedroom"),
        area: P("1BHK in Kharadi"),
        timeline: U(),
        budget: F("My budget is 1 to 1.5 lakh maximum for everything"),
        decision_maker: U(),
      },
      in_scope_confidence: 0.85,
      out_of_scope_confidence: 0.05,
    }),
  },

  T11: {
    expected: { outcome: "qualified" },
    fixture: lead({
      ...home,
      scope_kind: "partial",
      scope_text: "Design living room, bedroom and kitchen — no structural changes",
      rooms_in_scope: 3,
      configuration: "2BHK",
      site_state: "Rented, quite bare; 3-year lease",
      locality: "Baner",
      decision_maker: "self",
      decision_maker_note: "Tenant; landlord has agreed as long as no walls are broken",
      criteria: {
        real_project: P("Properly design the living room, bedroom, and kitchen"),
        area: P("2BHK in Baner"),
        timeline: U("No deadline given"),
        budget: U("Budget not mentioned"),
        decision_maker: P("Landlord is fine with it as long as we don't break walls"),
      },
      in_scope_confidence: 0.88,
      out_of_scope_confidence: 0.04,
      watch_for: ["Rented flat — keep everything reversible, modular kitchen"],
    }),
  },

  T12: {
    expected: { outcome: "qualified", flags_include: ["site_visit_requested"] },
    fixture: lead({
      ...home,
      category: "villa",
      caller_name: "Anand Sharma",
      scope_kind: "full_home",
      scope_text: "Full end-to-end design — villa, ground plus two floors",
      carpet_sqft: 5500,
      site_state: "New construction, possession last month, completely empty",
      locality: "Kalyani Nagar",
      timeline_text: "Move in March next year, no rush",
      completion_by: "2027-03-31",
      decision_maker: "self",
      wants_site_visit: true,
      criteria: {
        real_project: P("Full end-to-end design"),
        area: P("Villa project in Kalyani Nagar"),
        timeline: P("March next year to move in. No rush."),
        budget: U("Budget not mentioned"),
        decision_maker: P("Calling about his own villa"),
      },
      in_scope_confidence: 0.95,
      out_of_scope_confidence: 0.02,
      watch_for: ["Wants principal designer on site this week or next"],
    }),
  },

  T13: {
    expected: { outcome: "qualified", flags_include: ["asked_about_price"] },
    fixture: lead({
      ...home,
      asked_about_price: true,
      scope_kind: "full_home",
      scope_text: "Kitchen, wardrobes in both bedrooms, living room",
      configuration: "3BHK",
      carpet_sqft: 1100,
      locality: "Aundh",
      criteria: {
        real_project: P("I want to redo my flat"),
        area: P("Flat in Aundh"),
        timeline: U("No deadline given"),
        budget: U("Budget not mentioned; asked for a rough range"),
        decision_maker: U("Not asked"),
      },
      in_scope_confidence: 0.86,
      out_of_scope_confidence: 0.03,
      watch_for: ["Pushed for a ballpark price"],
    }),
  },

  T14: {
    expected: { outcome: "qualified", flags_include: ["decision_maker_unclear"] },
    fixture: lead({
      ...home,
      scope_kind: "full_home",
      scope_text: "Proper design for parents' new 3BHK",
      configuration: "3BHK",
      site_state: "New possession",
      locality: "Hadapsar",
      decision_maker: "on_behalf_unconfirmed",
      decision_maker_note: "Son calling; parents own the flat, will attend the consultation and decide",
      criteria: {
        real_project: P("They want a proper design"),
        area: P("3BHK in Hadapsar"),
        timeline: U("No deadline given"),
        budget: U("Budget not mentioned"),
        decision_maker: U("I'll tell them about the consultation and they'll decide"),
      },
      in_scope_confidence: 0.82,
      out_of_scope_confidence: 0.05,
      watch_for: ["Caller is the son — parents decide and will attend"],
    }),
  },

  T15: {
    expected: { outcome: "qualified" },
    fixture: lead({
      ...home,
      caller_name: "Smita",
      scope_kind: "full_home",
      scope_text: "Full home — kitchen, wardrobes, living room",
      configuration: "2BHK",
      carpet_sqft: 875,
      site_state: "Under construction; possession in about six weeks; builder allows access",
      locality: "Undri",
      timeline_text: "Possession in six weeks; start design right away",
      site_available_from: "2026-10-30",
      decision_maker: "self",
      decision_maker_note: "Owner with husband, who said to go ahead",
      criteria: {
        real_project: P("Full home — kitchen, wardrobes, living room"),
        area: P("Flat in Undri"),
        timeline: P("Getting possession in about six weeks"),
        budget: U("Budget not mentioned"),
        decision_maker: P("My husband and I. He said to go ahead and book"),
      },
      in_scope_confidence: 0.93,
      out_of_scope_confidence: 0.02,
    }),
  },

  T16: {
    expected: {
      outcome: "review",
      flags_include: ["repeat_caller", "frustrated"],
      note: "RELABELLED from qualified: the transcript never captures scope, so criterion 1 is unclear and the rubric sends it to review. In a live call the agent asks the scope question and this becomes qualified.",
    },
    fixture: lead({
      project_type: "residential",
      category: "apartment",
      caller_name: "Girish Nair",
      repeat_caller: true,
      frustrated: true,
      scope_text: "A project for his 3BHK (details not repeated on this call)",
      configuration: "3BHK",
      locality: "Viman Nagar",
      criteria: {
        real_project: U("I told someone about my 3BHK in Viman Nagar"),
        area: P("3BHK in Viman Nagar"),
        timeline: U(),
        budget: U("Budget not mentioned"),
        decision_maker: U(),
      },
      in_scope_confidence: 0.7,
      out_of_scope_confidence: 0.05,
      watch_for: ["Called Monday, no follow-up — frustrated", "This is not a good sign if you forget before you even start"],
    }),
  },

  T17: {
    expected: { outcome: "qualified" },
    fixture: lead({
      ...home,
      caller_name: "Ritu Kapoor",
      scope_kind: "full_home",
      scope_text: "Kitchen, wardrobes, living room — replacing basic builder furniture",
      configuration: "3BHK",
      carpet_sqft: 1050,
      site_state: "Lived in two years with builder furniture",
      locality: "Pimple Saudagar",
      timeline_text: "Ideally done by March",
      completion_by: "2027-03-31",
      criteria: {
        real_project: P("Kitchen, wardrobes, living room"),
        area: P("I'm Ritu Kapoor from Pimple Saudagar"),
        timeline: P("Ideally done by March. Plenty of time."),
        budget: U("Budget not mentioned"),
        decision_maker: U("Not asked"),
      },
      in_scope_confidence: 0.9,
      out_of_scope_confidence: 0.03,
      watch_for: ["First call dropped after 1 min 12 sec; caller rang back"],
    }),
  },

  T18: {
    expected: {
      outcome: "review",
      flags_include: ["commercial_below_min"],
      note: "Review only while COMMERCIAL_MIN_SQFT is unconfirmed. Becomes declined (commercial_size) when the mode is switched to 'decline'.",
    },
    fixture: lead({
      project_type: "commercial",
      category: "coworking",
      engagement: "design_and_execution",
      scope_kind: "commercial_fitout",
      scope_text: "A 180 sq ft pod in a coworking space — lighting, desk, storage",
      carpet_sqft: 180,
      decision_maker: "self",
      decision_maker_note: "Runs the coworking space",
      criteria: {
        real_project: P("Good lighting, a nice desk, some storage"),
        area: U("Location not given"),
        timeline: U(),
        budget: U("Budget not mentioned"),
        decision_maker: P("I run a small coworking space"),
      },
      in_scope_confidence: 0.35,
      out_of_scope_confidence: 0.6,
    }),
  },

  T19: {
    expected: { outcome: "declined", decline_reason: "category" },
    fixture: lead({
      project_type: "commercial",
      category: "restaurant",
      engagement: "design_and_execution",
      scope_kind: "commercial_fitout",
      scope_text: "Interiors for a new restaurant",
      locality: "Koregaon Park",
      criteria: {
        real_project: P("Would you be able to design the interiors?"),
        area: P("Restaurant in Koregaon Park"),
        timeline: U(),
        budget: U("Budget not mentioned"),
        decision_maker: U(),
      },
      in_scope_confidence: 0.05,
      out_of_scope_confidence: 0.95,
    }),
  },

  T20: {
    expected: { outcome: "qualified" },
    fixture: lead({
      ...home,
      caller_name: "Pooja",
      scope_kind: "full_home",
      scope_text: "Kitchen, both bedrooms, living room",
      configuration: "2BHK",
      carpet_sqft: 900,
      locality: "Magarpatta — Cybercity area",
      timeline_text: "Flexible — January start for execution would be ideal",
      decision_maker: "self",
      decision_maker_note: "Owner with husband; both will attend",
      criteria: {
        real_project: P("Kitchen, both bedrooms, living room"),
        area: P("2BHK in Magarpatta — Cybercity area"),
        timeline: P("We're flexible — a January start for execution would be ideal"),
        budget: U("Budget not mentioned"),
        decision_maker: P("My husband and I. We both want to be at the consultation"),
      },
      in_scope_confidence: 0.93,
      out_of_scope_confidence: 0.02,
    }),
  },
};

/**
 * Synthetic phone cases for paths the real transcripts never exercise.
 * Adapted from the WhatsApp/web-form enquiries in the same seed PDF.
 * Scored separately from the real cases.
 */
export const SYNTHETIC: SyntheticCase[] = [
  {
    id: "S01",
    adapted_from: "W10 (just exploring)",
    call_started_at: "2026-09-23T18:44:00+05:30",
    transcript: [
      { speaker: "caller", text: "Hi, I have a 3BHK in Hinjewadi. We're still early stage — just exploring, not sure we'll do anything yet." },
    ],
    expected: { outcome: "redirect" },
    fixture: lead({
      ...home,
      unsure_intent: true,
      configuration: "3BHK",
      locality: "Hinjewadi",
      scope_text: "Exploring options for the home",
      criteria: { ...lead({}).criteria, real_project: U("Just exploring"), area: P("3BHK in Hinjewadi") },
      in_scope_confidence: 0.5,
      out_of_scope_confidence: 0.2,
    }),
  },
  {
    id: "S02",
    adapted_from: "F03 (Talegaon)",
    call_started_at: "2026-09-06T11:18:00+05:30",
    transcript: [
      { speaker: "caller", text: "We've just got possession of a 3BHK independent house in Talegaon Dabhade, about 1,400 sq ft. I know it's a bit outside Pune — can you still take it up?" },
    ],
    expected: { outcome: "declined", decline_reason: "area" },
    fixture: lead({
      ...home,
      category: "independent_house",
      scope_kind: "full_home",
      carpet_sqft: 1400,
      locality: "Talegaon Dabhade",
      criteria: { ...lead({}).criteria, real_project: P("Need to do everything from scratch"), area: F("Talegaon Dabhade, near Pune") },
      in_scope_confidence: 0.4,
      out_of_scope_confidence: 0.6,
    }),
  },
  {
    id: "S03",
    adapted_from: "F08 (3-week deadline)",
    call_started_at: "2026-09-18T18:44:00+05:30",
    transcript: [
      { speaker: "caller", text: "Guests are arriving from the US in 3 weeks. We want the living room and kitchen of our Wakad 2BHK done before they come." },
    ],
    expected: { outcome: "declined", decline_reason: "timeline" },
    fixture: lead({
      ...home,
      scope_kind: "partial",
      rooms_in_scope: 2,
      carpet_sqft: 875,
      locality: "Wakad",
      timeline_text: "3 weeks maximum",
      completion_by: "2026-10-09",
      criteria: { ...lead({}).criteria, real_project: P("Living room and kitchen"), area: P("Wakad"), timeline: F("3 weeks maximum") },
      in_scope_confidence: 0.4,
      out_of_scope_confidence: 0.5,
    }),
  },
  {
    id: "S04",
    adapted_from: "synthetic (adjoining area)",
    call_started_at: "2026-09-20T12:00:00+05:30",
    transcript: [
      { speaker: "caller", text: "I have a 2BHK in Wagholi, around 900 sq ft, want full interiors done by March." },
    ],
    expected: { outcome: "review", flags_include: ["area_unclear"] },
    fixture: lead({
      ...home,
      scope_kind: "full_home",
      carpet_sqft: 900,
      locality: "Wagholi",
      completion_by: "2027-03-31",
      timeline_text: "By March",
      decision_maker: "self",
      criteria: { ...lead({}).criteria, real_project: P("Full interiors"), area: U("Wagholi"), timeline: P("By March") },
      in_scope_confidence: 0.85,
      out_of_scope_confidence: 0.05,
    }),
  },
  {
    id: "S05",
    adapted_from: "F02 (2 rooms, Baner) with a volunteered budget",
    call_started_at: "2026-09-04T19:12:00+05:30",
    transcript: [
      { speaker: "caller", text: "Master bedroom and living room in our Baner 3BHK. Budget is around 6 lakh." },
      { speaker: "agent", text: "Just to confirm — six lakh?" },
      { speaker: "caller", text: "Yes, six." },
    ],
    expected: { outcome: "qualified", flags_include: ["budget_tight"] },
    fixture: lead({
      ...home,
      scope_kind: "partial",
      rooms_in_scope: 2,
      carpet_sqft: 1100,
      locality: "Baner",
      decision_maker: "self",
      budget_inr: 600000,
      budget_confirmed: true,
      criteria: {
        ...lead({}).criteria,
        real_project: P("Master bedroom and living room"),
        area: P("Baner"),
        timeline: U("No deadline"),
        budget: P("Around 6 lakh — confirmed"),
      },
      in_scope_confidence: 0.86,
      out_of_scope_confidence: 0.04,
    }),
  },
  {
    id: "S06",
    adapted_from: "W07 (gym)",
    call_started_at: "2026-09-05T16:52:00+05:30",
    transcript: [{ speaker: "caller", text: "I'm opening a gym in Kothrud, about 2,500 sq ft. Would you design the interiors?" }],
    expected: { outcome: "declined", decline_reason: "category" },
    fixture: lead({
      project_type: "commercial",
      category: "gym",
      engagement: "design_and_execution",
      scope_kind: "commercial_fitout",
      carpet_sqft: 2500,
      locality: "Kothrud",
      in_scope_confidence: 0.1,
      out_of_scope_confidence: 0.9,
    }),
  },
  {
    id: "S07",
    adapted_from: "W03 (Hindi, code-mixed)",
    call_started_at: "2026-09-12T10:45:00+05:30",
    transcript: [
      { speaker: "caller", text: "Namaste. Mera flat hai Pimple Nilakh mein, 3BHK. Interior design karwana hai poora ghar. Main hi owner hoon. March tak ho jaye toh achha." },
    ],
    expected: { outcome: "qualified" },
    fixture: lead({
      ...home,
      caller_name: "Sunil Yadav",
      scope_kind: "full_home",
      configuration: "3BHK",
      locality: "Pimple Nilakh",
      completion_by: "2027-03-31",
      timeline_text: "March tak",
      decision_maker: "self",
      criteria: {
        ...lead({}).criteria,
        real_project: P("Interior design karwana hai poora ghar"),
        area: P("Pimple Nilakh"),
        timeline: P("March tak ho jaye"),
        decision_maker: P("Main hi owner hoon"),
      },
      in_scope_confidence: 0.9,
      out_of_scope_confidence: 0.03,
    }),
  },
  {
    id: "S09",
    adapted_from: "synthetic (reluctant caller — short answers, volunteers nothing)",
    call_started_at: "2026-10-07T18:20:00+05:30",
    transcript: [
      { speaker: "agent", text: "May I have your name, please?" },
      { speaker: "caller", text: "Kiran." },
      { speaker: "agent", text: "What would you like done?" },
      { speaker: "caller", text: "Interiors for my flat." },
      { speaker: "agent", text: "Is that the full flat, with design and execution?" },
      { speaker: "caller", text: "Yes, everything. 2BHK." },
      { speaker: "agent", text: "Which area, and the PIN code?" },
      { speaker: "caller", text: "Wakad. Don't know the PIN offhand." },
      { speaker: "agent", text: "When would you need it complete?" },
      { speaker: "caller", text: "Before February." },
      { speaker: "agent", text: "Will you be the one deciding?" },
      { speaker: "caller", text: "Yes." },
      { speaker: "agent", text: "Do you have a rough budget in mind? It's fine if not." },
      { speaker: "caller", text: "I'd rather not say." },
    ],
    expected: { outcome: "qualified", flags_include: ["budget_not_given"] },
    fixture: lead({
      ...home,
      caller_name: "Kiran",
      scope_kind: "full_home",
      scope_text: "Interiors for the full flat, everything",
      configuration: "2BHK",
      locality: "Wakad",
      timeline_text: "Before February",
      completion_by: "2027-01-31",
      decision_maker: "self",
      criteria: {
        real_project: P("Yes, everything. 2BHK."),
        area: P("Wakad"),
        timeline: P("Before February"),
        budget: U("I'd rather not say"),
        decision_maker: P("Yes"),
      },
      in_scope_confidence: 0.9,
      out_of_scope_confidence: 0.03,
    }),
  },
  {
    id: "S10",
    adapted_from: "synthetic (very guarded caller — shares almost nothing → helpdesk callback)",
    call_started_at: "2026-10-07T21:10:00+05:30",
    transcript: [
      { speaker: "caller", text: "I want to know about getting my house done." },
      { speaker: "agent", text: "Which area is it in?" },
      { speaker: "caller", text: "I'd rather discuss that with the designer." },
      { speaker: "agent", text: "When would you need it complete?" },
      { speaker: "caller", text: "Not sure yet." },
    ],
    expected: { outcome: "review", note: "Qualification says review (area unclear); routing then sends it to 'Callback needed' because 3+ core fields are missing." },
    fixture: lead({
      ...home,
      scope_kind: "full_home",
      scope_text: "Getting the house done",
      timeline_text: "Not sure yet",
      criteria: { ...lead({}).criteria, real_project: P("getting my house done"), area: U("I'd rather discuss that with the designer"), timeline: U("Not sure yet") },
      in_scope_confidence: 0.7,
      out_of_scope_confidence: 0.1,
    }),
  },
  {
    id: "S11",
    adapted_from: "synthetic (existing client asks for their designer — message, not a lead)",
    call_started_at: "2026-10-08T18:40:00+05:30",
    transcript: [
      { speaker: "caller", text: "Hi, it's Meenal. I wanted to speak to Rohan about my kitchen — the tile samples." },
    ],
    expected: { outcome: null, excluded: "Message path (not a lead) — exercised by simulation, not the qualification eval." },
    fixture: null,
  },
  {
    id: "S08",
    adapted_from: "synthetic (no hard rule, clearly out of scope)",
    call_started_at: "2026-09-26T15:00:00+05:30",
    transcript: [
      { speaker: "caller", text: "We're renovating our society's temple hall in Aundh — can you do the interiors and the stage for festivals?" },
    ],
    expected: { outcome: "declined", decline_reason: "out_of_scope" },
    fixture: lead({
      project_type: "commercial",
      category: "other",
      engagement: "design_and_execution",
      locality: "Aundh",
      scope_text: "Temple hall interiors and festival stage",
      in_scope_confidence: 0.1,
      out_of_scope_confidence: 0.85,
    }),
  },
];
