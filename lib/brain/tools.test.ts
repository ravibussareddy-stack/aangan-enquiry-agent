/** Server-side tool rules — deterministic, no LLM. */
import { describe, expect, it } from "vitest";
import { MockCalendar } from "../booking/mock-calendar";
import { seedRuntimeConfig } from "../config/runtime";
import { MockCrm } from "../crm/mock";
import { startSession } from "./session";
import { executeTool, type BrainDeps } from "./tools";

const now = new Date("2026-10-08T12:00:00+05:30");
function setup() {
  const deps: BrainDeps = { calendar: new MockCalendar(), crm: new MockCrm(), config: seedRuntimeConfig(), now: () => now };
  const state = startSession(deps, { callId: "t", provider: "simulated", direction: "inbound", callerPhone: "+919000000001" });
  // As if the server had already prompted the agent to ask these (so "not known" is legitimate).
  state.intakePrompted.push("budget", "pin");
  return { deps, state };
}
const homeFacts = {
  caller_name: "Neha",
  call_intent: "new_enquiry" as const,
  pin: "411014",
  carpet_sqft: 550,
  site_state: "lived in",
  timeline_text: "no fixed deadline",
  decision_maker: "self" as const,
  researched_us: "yes" as const,
  not_known: ["budget"],
  scope_text: "kitchen and one bedroom",
  engagement: "design_and_execution" as const,
  project_type: "residential" as const,
  scope_kind: "partial" as const,
  rooms_in_scope: 2,
  locality: "Kharadi",
  in_scope_confidence: 0.9,
  out_of_scope_confidence: 0.05,
  criteria: { real_project: { verdict: "pass" as const, evidence: "" }, timeline: { verdict: "pass" as const, evidence: "" } },
};

describe("brain tools", () => {
  it("refuses to evaluate before the scope is known", async () => {
    const { deps, state } = setup();
    const r = await executeTool("evaluate_lead", { facts: { locality: "Baner" }, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(r.next_step).toBe("ask");
  });

  it("makes the agent confirm a budget before judging it (T10 regression)", async () => {
    const { deps, state } = setup();
    state.transcript.push({ speaker: "caller", text: "My budget is 1 to 1.5 lakh maximum", at: now.toISOString() });
    const first = await executeTool("evaluate_lead", { facts: { ...homeFacts, budget_inr: 150000, budget_confirmed: true }, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(first.next_step).toBe("confirm_budget");

    state.transcript.push({ speaker: "agent", text: "Just to confirm — 1.5 lakh?", at: now.toISOString() });
    state.transcript.push({ speaker: "caller", text: "Yes", at: now.toISOString() });
    const second = await executeTool("evaluate_lead", { facts: {}, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(second.next_step).toBe("declined");
    expect(String(second.say_line)).not.toMatch(/\d/); // no figure in the decline line
  });

  it("only offers slots after a qualified evaluation, and books only offered slots", async () => {
    const { deps, state } = setup();
    expect((await executeTool("get_slots", { preference: null, site_visit: false }, state, deps)).error).toBeTruthy();
    await executeTool("evaluate_lead", { facts: { ...homeFacts, rooms_in_scope: 3 }, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    const slots = await executeTool("get_slots", { preference: "saturday morning", site_visit: false, typical_budget_reaction: "comfortable" }, state, deps);
    expect((slots.slots as unknown[]).length).toBeGreaterThan(0);
    expect((await executeTool("book_slot", { slot_id: "nope", caller_name: "A" }, state, deps)).error).toBeTruthy();
    const booked = await executeTool("book_slot", { slot_id: "s1", caller_name: "A" }, state, deps);
    expect(booked.confirmed).toBeTruthy();
  });

  it("declines a hard-rule fail in check_scope with a figure-free line", async () => {
    const { deps, state } = setup();
    const r = await executeTool("check_scope", { facts: { category: "restaurant", project_type: "commercial", engagement: "design_and_execution" } }, state, deps);
    expect(r.status).toBe("out_of_scope");
    expect(String(r.say_line)).toMatch(/Restaurants/);
  });

  it("rejects malformed tool arguments without throwing", async () => {
    const { deps, state } = setup();
    const r = await executeTool("book_slot", { slot_id: 5 }, state, deps);
    expect(r.error).toMatch(/Invalid arguments/);
  });
});

describe("fixes from bulk simulation", () => {
  it("does not escalate a frustrated new caller as a complaint (T16)", async () => {
    const { deps, state } = setup();
    const r = await executeTool("escalate_complaint", { about_existing_aangan_project: false, summary: "No callback since Monday", wants_senior: null, free_times: null }, state, deps);
    expect(r.escalated).toBe(false);
    expect(state.complaint).toBeNull();
    expect(state.facts.frustrated).toBe(true);
  });

  it("lets the agent clear a misrecorded deadline (T15 possession ≠ completion)", async () => {
    const { deps, state } = setup();
    await executeTool("check_scope", { facts: { ...homeFacts, completion_in_weeks: 3 } }, state, deps);
    expect(state.scope?.status).toBe("out_of_scope");
    const r = await executeTool("check_scope", { facts: { site_available_in_weeks: 6 }, clear: ["completion_in_weeks"] }, state, deps);
    expect(state.facts.completion_in_weeks).toBeUndefined();
    expect(r.status).toBe("in_scope");
  });
});

describe("server-side date maths", () => {
  it("turns 'three or four months' (13 weeks) into a passing deadline (S05 regression)", async () => {
    const { deps, state } = setup();
    const r = await executeTool("check_scope", { facts: { ...homeFacts, completion_in_weeks: 13 } }, state, deps);
    expect(r.status).toBe("in_scope");
  });
});

describe("intake sheet gating", () => {
  it("sends the agent back for missing fields, then decides anyway after two nudges", async () => {
    const { deps, state } = setup();
    const thin = { scope_text: "full flat", engagement: "design_and_execution" as const, project_type: "residential" as const, locality: "Baner" };
    const first = await executeTool("evaluate_lead", { facts: thin, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(first.next_step).toBe("ask");
    expect(first.missing).toContain("PIN code");
    expect((await executeTool("evaluate_lead", { facts: {}, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps)).next_step).toBe("ask");
    const third = await executeTool("evaluate_lead", { facts: {}, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(third.next_step).not.toBe("ask"); // safety valve: never stalls the call
  });

  it("accepts 'caller didn't know' for a field", async () => {
    const { deps, state } = setup();
    const r = await executeTool("evaluate_lead", { facts: { ...homeFacts, pin: undefined, not_known: ["budget", "pin"] }, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(r.next_step).not.toBe("ask");
  });

  it("does not gate once the call is past the wrap-up time", async () => {
    const { deps, state } = setup();
    state.startedAt = new Date(now.getTime() - 300_000).toISOString();
    const r = await executeTool("evaluate_lead", { facts: { scope_text: "full flat", engagement: "design_and_execution", project_type: "residential", locality: "Baner" }, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(r.next_step).not.toBe("ask");
  });
});

describe("callback window must come from the caller (T18 regression)", () => {
  it("rejects a time the caller never said", async () => {
    const { deps, state } = setup();
    state.transcript.push({ speaker: "caller", text: "It's a 180 sq ft pod in Baner", at: now.toISOString() });
    const r = await executeTool("request_callback", { window: "Anytime tomorrow", caller_quote: "anytime tomorrow" }, state, deps);
    expect(r.recorded).toBe(false);
    expect(state.callbackWindow).toBeNull();
  });

  it("records the caller's own words", async () => {
    const { deps, state } = setup();
    state.transcript.push({ speaker: "caller", text: "Tomorrow after 5 pm works best.", at: now.toISOString() });
    const r = await executeTool("request_callback", { window: "Tomorrow after 5 pm", caller_quote: "tomorrow after 5 pm" }, state, deps);
    expect(r.recorded).toBe(true);
    expect(state.callbackWindow).toBe("Tomorrow after 5 pm");
  });
});

describe("evaluate_lead arguments", () => {
  it("requires the agent's confidences (no silent 0.5 default)", async () => {
    const { deps, state } = setup();
    const r = await executeTool("evaluate_lead", { facts: homeFacts }, state, deps);
    expect(String(r.error)).toMatch(/in_scope_confidence/);
  });

  it("skips intake questions once a hard rule has declined the lead", async () => {
    const { deps, state } = setup();
    const r = await executeTool("evaluate_lead", { facts: { scope_text: "restaurant fit-out", engagement: "design_and_execution", category: "restaurant", project_type: "commercial" }, in_scope_confidence: 0.1, out_of_scope_confidence: 0.9 }, state, deps);
    expect(r.next_step).toBe("declined");
  });
});

describe("intake integrity (S09 regressions)", () => {
  it("ignores 'not known' for a field the agent was never prompted to ask", async () => {
    const { deps, state } = setup();
    const facts = { ...homeFacts, decision_maker: undefined, not_known: ["decision_maker", "budget"] };
    const r = await executeTool("evaluate_lead", { facts, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(r.next_step).toBe("ask");
    expect(r.missing).toContain("Decision-maker");
  });

  it("maps loose key names and accepts them once prompted", async () => {
    const { deps, state } = setup();
    state.intakePrompted.push("budget", "site_ready");
    await executeTool("check_scope", { facts: { ...homeFacts, not_known: ["budget_inr", "site_state"] } }, state, deps);
    expect(state.facts.not_known).toEqual(["budget", "site_ready"]);
  });

  it("does not prompt the same question twice in a row", async () => {
    const { deps, state } = setup();
    const thin = { scope_text: "full flat", engagement: "design_and_execution" as const, project_type: "residential" as const, locality: "Baner", caller_name: "K", pin: "411045" };
    const a = await executeTool("check_scope", { facts: thin }, state, deps);
    const b = await executeTool("check_scope", { facts: {} }, state, deps);
    expect(a.next_question).not.toEqual(b.next_question);
  });
});

describe("callback routing in-call", () => {
  it("returns next_step 'callback' when core details are still missing after the nudges", async () => {
    const { deps, state } = setup();
    const thin = { scope_text: "full flat", engagement: "design_and_execution" as const, project_type: "residential" as const, caller_name: "K" };
    await executeTool("evaluate_lead", { facts: thin, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    await executeTool("evaluate_lead", { facts: {}, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    const r = await executeTool("evaluate_lead", { facts: {}, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(r.next_step).toBe("callback");
    expect(state.evaluation?.outcome).toBe("callback");
  });
});

describe("call intent", () => {
  it("takes a message for a named designer instead of qualifying", async () => {
    const { deps, state } = setup();
    state.facts = { ...state.facts, call_intent: "specific_designer", requested_person: "Aryan" };
    expect((await executeTool("evaluate_lead", { facts: {}, in_scope_confidence: 0.5, out_of_scope_confidence: 0.1 }, state, deps)).next_step).toBe("message");
    state.transcript.push({ speaker: "caller", text: "Tell Aryan to call me after 6 pm today", at: now.toISOString() });
    const r = await executeTool(
      "take_message",
      { intent: "specific_designer", for_person: "Aryan", about: "Wants to discuss tile samples", callback_window: "after 6 pm today", caller_quote: "after 6 pm today" },
      state,
      deps,
    );
    expect(r.recorded).toBe(true);
    expect(state.message).toMatchObject({ forPerson: "Aryan", callbackWindow: "after 6 pm today" });
  });

  it("won't record a message callback time the caller never said", async () => {
    const { deps, state } = setup();
    const r = await executeTool("take_message", { intent: "other", for_person: null, about: "vendor", callback_window: "tomorrow", caller_quote: "tomorrow" }, state, deps);
    expect(r.recorded).toBe(false);
  });
});

describe("review leads must get a callback time (T18 regression 2)", () => {
  it("refuses to end a review call once until the caller gives a time", async () => {
    const { deps, state } = setup();
    state.evaluation = { outcome: "review", declineReason: null, flags: [], reasons: [] };
    const first = await executeTool("end_call", { reason: "callback_promised" }, state, deps);
    expect(first.ok).toBe(false);
    expect(state.ended).toBe(false);
    const second = await executeTool("end_call", { reason: "callback_promised" }, state, deps);
    expect(second.ok).toBe(true); // never traps the call if the caller won't give a time
  });
});

describe("typical budget (SHARE_TYPICAL_BUDGET)", () => {
  it("gives the server-written line once when the caller has no budget", async () => {
    const { deps, state } = setup();
    const r1 = await executeTool("evaluate_lead", { facts: homeFacts, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(String(r1.budget_guidance)).toMatch(/^Typically, .* comes to around .* lakh rupees\. That's a typical range/);
    const r2 = await executeTool("evaluate_lead", { facts: {}, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(r2.budget_guidance).toBeUndefined(); // only once
  });

  it("does not share it when the caller gave a budget", async () => {
    const { deps, state } = setup();
    state.transcript.push({ speaker: "caller", text: "Budget is about 20 lakh", at: now.toISOString() });
    state.transcript.push({ speaker: "agent", text: "Just to confirm — 20 lakh?", at: now.toISOString() });
    const r = await executeTool("evaluate_lead", { facts: { ...homeFacts, budget_inr: 2000000 }, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(r.budget_guidance).toBeUndefined();
  });
});

describe("typical budget comfort check", () => {
  async function qualifiedWithGuidance() {
    const { deps, state } = setup();
    await executeTool("evaluate_lead", { facts: homeFacts, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(state.budgetGuidance).toMatch(/Are you comfortable going ahead on that basis\?$/);
    return { deps, state };
  }

  it("won't offer slots until the caller answers the comfort question", async () => {
    const { deps, state } = await qualifiedWithGuidance();
    expect((await executeTool("get_slots", { preference: null, site_visit: false }, state, deps)).error).toMatch(/comfortable/);
    const ok = await executeTool("get_slots", { preference: null, site_visit: false, typical_budget_reaction: "comfortable" }, state, deps);
    expect((ok.slots as unknown[]).length).toBeGreaterThan(0);
  });

  it("asks for their range once if they're not comfortable, then lets them proceed", async () => {
    const { deps, state } = await qualifiedWithGuidance();
    const first = await executeTool("get_slots", { preference: null, site_visit: false, typical_budget_reaction: "not_comfortable" }, state, deps);
    expect(String(first.error)).toMatch(/What range would you be comfortable with/);
    const second = await executeTool("get_slots", { preference: null, site_visit: false, typical_budget_reaction: "not_comfortable" }, state, deps);
    expect(second.error).toBeUndefined();
  });
});

describe("sign-off", () => {
  it("adds 'Have a good day!' to the agent's last line", async () => {
    const { withSignOff } = await import("./session");
    expect(withSignOff("That's booked for Thursday at 2 pm. An SMS confirmation will follow.")).toBe(
      "That's booked for Thursday at 2 pm. An SMS confirmation will follow. Have a good day!",
    );
    expect(withSignOff("Thanks for calling Aangan Studio")).toBe("Thanks for calling Aangan Studio. Have a good day!");
    expect(withSignOff("Thank you, have a great day!")).toBe("Thank you, have a great day!");
  });
});

describe("price questions → server-written typical range", () => {
  it("first ask: full line with disclaimer + comfort check; next asks: short repeat; all approved", async () => {
    const { deps, state } = setup();
    const first = await executeTool("typical_budget", { facts: { project_type: "residential", scope_kind: "full_home", carpet_sqft: 1100, configuration: "3BHK" } }, state, deps);
    expect(first.say).toBe(
      "Typically, a 3BHK of about 1,100 square feet comes to around 20 to 26 lakh rupees. That's a typical range — it's indicative and depends on the locality and your requirements. Are you comfortable going ahead on that basis?",
    );
    const again = await executeTool("typical_budget", {}, state, deps);
    expect(String(again.say)).toMatch(/^As I mentioned, typically a 3BHK .* designer will confirm the exact figure/);
    expect(state.approvedLines).toEqual([first.say, again.say]);
    expect(state.facts.asked_about_price).toBe(true);
  });

  it("budget step doesn't repeat the range if a price question already got it", async () => {
    const { deps, state } = setup();
    await executeTool("typical_budget", { facts: { project_type: "residential", carpet_sqft: 550 } }, state, deps);
    const r = await executeTool("evaluate_lead", { facts: homeFacts, in_scope_confidence: 0.9, out_of_scope_confidence: 0.05 }, state, deps);
    expect(r.budget_guidance).toBeUndefined();
  });
});
