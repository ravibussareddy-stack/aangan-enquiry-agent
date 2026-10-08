/**
 * Voice agent tool definitions. Argument schemas are derived from the shared
 * lead schema (lib/schema/lead.ts) so the agent, the server and post-call
 * extraction agree on every field.
 */
import { z } from "zod";
import { LeadExtraction } from "../lib/schema/lead";

/** Everything the agent may report about the lead so far — all optional. */
export const LeadFacts = LeadExtraction.pick({
  caller_name: true,
  call_intent: true,
  requested_person: true,
  complaint_detected: true,
  unsure_intent: true,
  repeat_caller: true,
  frustrated: true,
  asked_about_price: true,
  project_type: true,
  category: true,
  engagement: true,
  structural_work_requested: true,
  scope_kind: true,
  scope_text: true,
  rooms_in_scope: true,
  configuration: true,
  carpet_sqft: true,
  site_state: true,
  locality: true,
  pin: true,
  city: true,
  timeline_text: true,
  decision_maker: true,
  decision_maker_note: true,
  budget_inr: true,
  budget_confirmed: true,
  wants_site_visit: true,
  callback_window: true,
  researched_us: true,
  referral: true,
  typical_budget_reaction: true,
})
  .partial()
  .extend({
    // The agent reports durations; the server turns them into dates (LLMs get date maths wrong).
    completion_in_weeks: z
      .number()
      .min(0)
      .optional()
      .describe("Weeks from today until the finished project is NEEDED (move-in, guests, opening). '3–4 months' → 13. Omit if no deadline."),
    site_available_in_weeks: z
      .number()
      .min(0)
      .optional()
      .describe("Weeks from today until the site can be worked on (possession/handover). Omit if available now."),
    not_known: z
      .array(z.string())
      .optional()
      .describe(
        "Intake fields you ASKED about but the caller couldn't or wouldn't answer. Use these keys: caller_name, intent, what_work, space_type, locality, pin, size, site_ready, deadline, decision_maker, budget, researched, callback_window. Only list a field you actually asked — never to skip a question.",
      ),
    criteria: LeadExtraction.shape.criteria.partial().optional(),
    in_scope_confidence: z.number().min(0).max(1).optional(),
    out_of_scope_confidence: z.number().min(0).max(1).optional(),
    watch_for: z.array(z.string()).optional(),
  });
export type LeadFacts = z.infer<typeof LeadFacts>;

const withFacts = z.object({
  facts: LeadFacts.describe("Everything learned so far. Only include fields the caller actually said."),
  clear: z
    .array(z.string())
    .optional()
    .describe("Names of fact fields to clear because the caller corrected them (e.g. a date that was misheard)."),
});

export const ToolArgs = {
  lookup_caller: z.object({}),
  escalate_complaint: z.object({
    free_times: z.string().nullable().describe("When the caller said they're generally free, in their words (null if they didn't say)."),
    about_existing_aangan_project: z
      .boolean()
      .describe("True only if the caller is an existing Aangan client complaining about their own Aangan project."),
    summary: z.string().describe("One or two sentences: who they are, which project, what went wrong."),
    wants_senior: z.string().nullable().describe("Named person they want a callback from, if any."),
  }),
  check_scope: withFacts,
  evaluate_lead: withFacts.extend({
    in_scope_confidence: z.number().min(0).max(1).describe("REQUIRED: 0–1, is the KIND of project something Aangan does (home/office design + execution in Pune)?"),
    out_of_scope_confidence: z.number().min(0).max(1).describe("REQUIRED: 0–1, is the KIND of project outside what Aangan does?"),
  }),
  typical_budget: z.object({
    facts: LeadFacts.optional().describe("Anything new you've learned (e.g. carpet area) so the range fits their space."),
  }),
  get_slots: z.object({
    typical_budget_reaction: z
      .enum(["comfortable", "not_comfortable", "unsure", "not_asked"])
      .optional()
      .describe("If you shared budget_guidance: the caller's answer to 'Are you comfortable going ahead on that basis?'"),
    preference: z.string().nullable().describe("Caller's day/time preference in their words, if any."),
    site_visit: z.boolean().describe("True if the caller wants the first consultation at the site."),
  }),
  book_slot: z.object({
    slot_id: z.string().describe("An id returned by get_slots."),
    caller_name: z.string(),
  }),
  take_message: z.object({
    intent: z.enum(["existing_project_update", "specific_designer", "other"]),
    for_person: z.string().nullable().describe("Designer/staff member they asked for by name, if any."),
    about: z.string().describe("The message, in a sentence — what they want and any project/reference they gave."),
    callback_window: z.string().describe("When they're generally free to take a call, summarised."),
    caller_quote: z.string().describe("The caller's exact words about when they're free — ask first, never assume."),
  }),
  request_callback: z.object({
    window: z.string().describe("When the caller is generally free to take a call, summarised."),
    caller_quote: z.string().describe("The caller's exact words about when they're free — you must have asked and they must have answered."),
  }),
  transfer_to_front_desk: z.object({}),
  end_call: z.object({
    reason: z.enum(["booked", "callback_promised", "declined", "complaint_escalated", "redirected", "caller_left", "other"]),
  }),
} as const;
export type ToolName = keyof typeof ToolArgs;

const DESCRIPTIONS: Record<ToolName, string> = {
  lookup_caller:
    "Look up the caller by phone number in the CRM. Returns whether they're an existing client, any open project, and anything captured on an earlier dropped call.",
  escalate_complaint:
    "Existing client with a complaint: alert a senior person to call back as soon as possible (never promise a time). Call once, then end the call.",
  check_scope:
    "Check the project against Aangan's hard rules (area, category, engagement, size, timeline). Returns in_scope, out_of_scope (with a close line) or uncertain (with what to ask).",
  evaluate_lead:
    "Final qualification once you've collected the details. Returns next_step: qualified, review, declined or redirect, with a say_line where needed.",
  typical_budget:
    "The caller asked about price, cost, rates, a ballpark or a quote. Returns the server-written typical range for their scope (with disclaimer) — say it exactly. Call it every time they ask; repeats come back shorter.",
  get_slots: "Get 2–3 consultation times to offer, from designers' calendars over the next 7 days.",
  book_slot: "Book one of the slots returned by get_slots. Returns the confirmed time.",
  take_message:
    "The caller is NOT making a new enquiry: they want an update on an existing project, want to reach a specific designer, or something else (vendor, job, etc.). Take a short message and a callback time in their words; the right person gets it on Telegram. Then close the call.",
  request_callback: "Record when the CALLER said they're generally free (review, callback and redirect leads). Ask first — never assume, and never promise a call-back time.",
  transfer_to_front_desk:
    "Caller is unsure whether they want a project at all. In office hours returns a transfer; after hours creates a callback task for the next opening.",
  end_call: "End the call after your final sentence.",
};

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

export function toolDeclarations() {
  return (Object.keys(ToolArgs) as ToolName[]).map((name) => ({
    name,
    description: DESCRIPTIONS[name],
    parametersJsonSchema: jsonSchema(ToolArgs[name]),
  }));
}
