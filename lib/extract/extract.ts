/**
 * Post-call structured extraction: fills the shared LeadExtraction schema from
 * the full transcript. This (not the in-call facts) is what gets stored and
 * evaluated. Runs server-side, so it may see the rubric — but never pricing.
 */
import { budgetEchoed } from "../compliance/price-scan";
import { generateJson, type GeminiResponse } from "../llm/gemini";
import { LeadExtraction, leadExtractionJsonSchema } from "../schema/lead";
import { nowForPrompt } from "../time/ist";

export interface Turn {
  speaker: "agent" | "caller" | "note";
  text: string;
}

const SYSTEM = `You extract structured data from a phone enquiry to Aangan Studio, an interior design studio in Pune (design + execution for homes and small offices/clinics/studios up to ~3,000 sq ft, in Pune city and PCMC only).

Fill every field of the schema from the transcript. Rules:
- Use only what was said. Unknown → null (or "unknown" for enums, false for booleans).
- call_intent: why they called — new_enquiry (a new project, even if they mention a designer by name), existing_project_issue (a problem with their ongoing Aangan project), existing_project_update (status question / message about an ongoing project, no complaint), specific_designer (just wants to reach a named person, not a new project), other (vendor, job seeker, sales, wrong number).
- requested_person: the staff member they asked for by name, else null.
- complaint_detected: an EXISTING Aangan client complaining about their own project. A new caller who is annoyed is "frustrated", not a complaint.
- unsure_intent: the caller opens unsure WHETHER they want a project at all ("just exploring", "maybe later"). Unsure about style/materials is NOT unsure_intent, and neither is hesitating ("let me think") after being told something can't be done.
- Judge from the CALLER's facts. Ignore the agent's/front desk's own opinions in the transcript (e.g. "that's below our minimum") when filling fields and confidences.
- engagement: design_and_execution when they want a space designed and done; advice_only/decor_only/furniture_sourcing_only/vastu_only/self_execution/structural when clearly so. If the caller never says what work they want, use unknown (and real_project = unclear).
- scope_kind: full_home for a whole flat/house (even if they list its rooms); partial for a floor or 2+ rooms; single_room for one room.
- rooms_in_scope: number of rooms to be done for partial/single_room (kitchen counts); null for full_home.
- Dates: resolve relative to the call date. Month only ("by March") → the last day of that month, choosing the next occurrence. "In six weeks" → call date + 42 days. completion_by = when it must be COMPLETE; PRIORITY: if anyone in the transcript says how far away the deadline is ("about three weeks away"), set completion_by = call date + that duration, even if it disagrees with the calendar. Otherwise resolve festivals/events from the calendar (Diwali 2026 = 2026-11-08, Dussehra 2026 = 2026-10-20, Christmas = 12-25). site_available_from = ONLY when the site physically can't be worked on before a date (possession, handover, tenant moving out); a preferred start date is NOT availability. Leave null if not stated.
- budget_inr: the CALLER's own budget only — ignore any typical/indicative figures the agent mentioned. Rupees; for a range use the UPPER bound (1 lakh = 100000). budget_confirmed = true if the agent/front desk repeated the caller's figure back and the caller confirmed it or did not correct it, or the caller stated it unambiguously twice; false if it was said once and never echoed.
- decision_maker: self (owner/decides), authorised (calling for the decider AND says the decider has authorised them to go ahead), on_behalf_unconfirmed (calling for someone else who will decide later — e.g. "they'll decide"), unknown (never discussed).
- criteria: for each of real_project, area, timeline, budget, decision_maker give pass/fail/unclear and a SHORT verbatim quote from the caller as evidence ("" if nothing was said). Budget not mentioned → unclear.
- in_scope_confidence / out_of_scope_confidence: your honest 0–1 judgement that the KIND of project is within / outside what Aangan does (design + execution, homes or small offices/clinics/studios, Pune/PCMC). Judge the type of work only — do NOT factor size, location, budget, timeline or decision-maker; those are judged separately by rules. Anchors: a home of any size (apartment, house, villa — full, partial or one room) wanting design + execution → in 0.9+, out ≤0.1. An office, clinic or studio fit-out → in 0.85+. Spaces Aangan doesn't design at all (temples/religious halls, schools, hospitals, showrooms, event or wedding decor, factories, warehouses) → out 0.85+. Use 0.5 only when genuinely unsure what kind of space it is. They need not sum to 1.
- researched_us: "yes" if they say they've seen Aangan's website, Instagram, portfolio or past projects (including a friend's flat Aangan did); "no" if they say they haven't; else "unknown".
- typical_budget_reaction: if the agent shared a typical budget range and asked "Are you comfortable going ahead on that basis?": comfortable / not_comfortable / unsure from the caller's answer; not_asked if no range was shared.
- referral: who sent them, if mentioned (e.g. "friend Shruti Joshi, past client", "builder Rohan Lifescapes"); else null.
- watch_for: short notes for the designer (repeat caller, frustration, asked about price, decision-maker absent, tight timeline…).`;

export async function extractLead(
  turns: Turn[],
  callAt: Date,
): Promise<{ extraction: LeadExtraction; response: GeminiResponse }> {
  const transcript = turns
    .map((t) => `${t.speaker === "agent" ? "AGENT" : t.speaker === "caller" ? "CALLER" : "NOTE"}: ${t.text}`)
    .join("\n");
  const { value, response } = await generateJson<unknown>({
    model: process.env.GEMINI_MODEL,
    system: SYSTEM,
    contents: [{ role: "user", parts: [{ text: `Call date: ${nowForPrompt(callAt)}\n\nTranscript:\n${transcript}` }] }],
    responseJsonSchema: leadExtractionJsonSchema(),
    temperature: 0,
    thinkingLevel: "low",
  });
  const parsed = LeadExtraction.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Extraction did not match schema: ${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const extraction = parsed.data;
  // Confirmation is a fact about the transcript, so check it deterministically too.
  if (!extraction.budget_confirmed && budgetEchoed(turns.filter((t) => t.speaker !== "note") as never, extraction.budget_inr)) {
    extraction.budget_confirmed = true;
  }
  return { extraction, response };
}
