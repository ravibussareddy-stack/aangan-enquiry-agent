/**
 * Founder's rubric (seed/qualified.md) → code. One `describe` per rubric section,
 * one test per rule, so a change that breaks the rubric fails CI.
 * Where the user deliberately overrode the rubric (budget), the test says so.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import seed from "../db/seed/config.json";
import { INTAKE_FIELDS } from "../lib/intake/sheet";
import { defaultQualifyConfig, evaluateLead } from "../lib/qualify";
import { routeForInfo } from "../lib/qualify/routing";
import { CALL_AT, makeLead } from "../lib/qualify/test-helpers";
import type { LeadExtraction } from "../lib/schema/lead";

const rubric = readFileSync("seed/qualified.md", "utf8");
const cfg = defaultQualifyConfig();
const evaluate = (o: Partial<LeadExtraction> = {}, at = CALL_AT) => evaluateLead(makeLead(o), cfg, at);
const fail = (evidence: string) => ({ verdict: "fail" as const, evidence });
const unclear = { verdict: "unclear" as const, evidence: "" };

describe("Criterion 1 — Real project, not just advice", () => {
  it.each([
    ["advice_only", "can you come and advise / just looking for ideas"],
    ["self_execution", "I'll do the execution myself"],
    ["decor_only", "decor/styling only"],
    ["vastu_only", "Vastu only"],
  ] as const)("declines %s (%s)", (engagement, phrase) => {
    expect(phrase).toBeTruthy(); // the rubric red flag this engagement covers
    const e = evaluate({ engagement });
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("engagement");
  });

  it("minimum engagement is a room redesign with full execution — a single room qualifies", () => {
    expect(evaluate({ scope_kind: "single_room", rooms_in_scope: 1 }).outcome).toBe("qualified");
  });
});

describe("Criterion 2 — In our service area (Pune city or PCMC)", () => {
  it.each(["Talegaon", "Nashik", "Mumbai"])("declines %s politely", (locality) => {
    const e = evaluate({ locality, city: null });
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("area");
  });

  it("accepts Pune and PCMC localities", () => {
    expect(evaluate({ locality: "Kothrud" }).outcome).toBe("qualified");
    expect(evaluate({ locality: "Pimple Saudagar" }).outcome).toBe("qualified");
  });
});

describe("Criterion 3 — Realistic timeline", () => {
  it("asks exactly the rubric's question", () => {
    expect(rubric).toContain(INTAKE_FIELDS.find((f) => f.key === "deadline")!.question);
  });

  it("declines 'needs it done in 3 weeks'", () => {
    const e = evaluate({ completion_by: "2026-10-28" });
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("timeline");
  });

  it("site not available within ~10 weeks → not forwarded as qualified (designer review, flagged)", () => {
    const e = evaluate({ completion_by: null, site_available_from: "2027-02-01" });
    expect(e.outcome).toBe("review");
    expect(e.flags).toContain("site_available_late");
  });
});

describe("Criterion 4 — Right budget band (broadly)", () => {
  const partial = { scope_kind: "partial" as const, rooms_in_scope: 2, carpet_sqft: 550, locality: "Kharadi" };

  it("a volunteered, clearly-too-low budget is addressed on the call and not forwarded (T10)", () => {
    const e = evaluate({ ...partial, budget_inr: 150_000, budget_confirmed: true });
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("budget");
  });

  it("if budget is not mentioned, treat as qualified", () => {
    const e = evaluate({ budget_inr: null });
    expect(e.outcome).toBe("qualified");
  });

  it("OWNER'S DECISION (2026-10-08) replaces 'Don't quote. Don't probe.': ask for a ballpark; if none, share the typical range with a disclaimer and ask if they're comfortable going ahead", () => {
    expect(rubric).toMatch(/Don't quote\. Don't probe\./);
    expect(seed.ASK_BUDGET.value).toBe(true);
    expect(seed.SHARE_TYPICAL_BUDGET.value).toBe(true);
    expect(seed.SHARE_TYPICAL_BUDGET.needs_founder_signoff).toBeFalsy();
  });
});

describe("Criterion 5 — Decision-maker on the call (or represented)", () => {
  it("the decider, or someone they've authorised (e.g. spouse), passes", () => {
    expect(evaluate({ decision_maker: "self" }).criteria.decision_maker.verdict).toBe("pass");
    expect(evaluate({ decision_maker: "authorised", decision_maker_note: "spouse said go ahead" }).criteria.decision_maker.verdict).toBe("pass");
  });

  it("'just doing research for my in-laws' is not sufficient on its own — flagged, never treated as a pass", () => {
    const e = evaluate({ decision_maker: "on_behalf_unconfirmed", decision_maker_note: "research for in-laws", criteria: { ...makeLead().criteria, decision_maker: unclear } });
    expect(e.criteria.decision_maker.verdict).not.toBe("pass");
    expect(e.flags).toContain("decision_maker_unclear");
  });
});

describe("At the boundary", () => {
  it("unclear on 1, 2 or 3 → ask one direct question (and don't forward as qualified)", () => {
    const e = evaluate({ locality: "Wagholi", city: null });
    expect(e.outcome).toBe("review");
    expect(e.askNext).toBe("area");
  });

  it("unclear on 4 or 5 → don't push: treat as qualified and note it for the designer", () => {
    const e = evaluate({ budget_inr: null, decision_maker: "unknown" });
    expect(e.outcome).toBe("qualified");
    expect(e.flags).toEqual(expect.arrayContaining(["budget_not_given", "decision_maker_unclear"]));
  });

  it("two or more criteria fail → decline gracefully with the rubric's exact words", () => {
    const e = evaluate({
      engagement: "unknown",
      decision_maker: "unknown",
      criteria: { ...makeLead().criteria, real_project: fail("just ideas"), decision_maker: fail("in-laws decide") },
      in_scope_confidence: 0.4,
    });
    expect(e.outcome).toBe("declined");
    const words = rubric.match(/"(This sounds like it may not be the right fit[^"]+)"/)![1];
    expect(seed.DECLINE_LINE.value).toBe(words);
  });

  it("fails one hard rule → close gracefully (declined, not forwarded)", () => {
    expect(evaluate({ category: "restaurant", project_type: "commercial" }).outcome).toBe("declined");
  });

  it("BRIEF RULE: a single non-hard failure goes to designer review instead of an automatic decline", () => {
    const e = evaluate({ decision_maker: "unknown", criteria: { ...makeLead().criteria, decision_maker: fail("not authorised") } });
    expect(e.outcome).toBe("review");
  });

  it("don't forward an incomplete lead → too little captured goes to the helpdesk, not designers", () => {
    const routed = routeForInfo({ outcome: "qualified", missing: ["locality", "deadline", "budget"], booked: false, rule: seed.INSUFFICIENT_INFO.value });
    expect(routed.status).toBe("callback");
  });
});

describe("What does NOT disqualify", () => {
  it("not knowing exactly what they want / uncertain about materials, style or layout", () => {
    expect(evaluate({ scope_text: "Not sure about the style yet — want the whole flat done", unsure_intent: false }).outcome).toBe("qualified");
  });

  it("calling outside office hours (answer, qualify, book)", () => {
    expect(evaluate({}, new Date("2026-10-07T23:30:00+05:30")).outcome).toBe("qualified");
  });

  it("asking for pricing (deflect, but do not disqualify)", () => {
    const e = evaluate({ asked_about_price: true });
    expect(e.outcome).toBe("qualified");
    expect(e.flags).toContain("asked_about_price");
  });

  it("a single room project", () => {
    expect(evaluate({ scope_kind: "single_room", rooms_in_scope: 1 }).outcome).toBe("qualified");
  });

  it("a rented apartment — fine as long as no structural changes", () => {
    expect(evaluate({ site_state: "rented, 3-year lease" }).outcome).toBe("qualified");
    expect(evaluate({ site_state: "rented", structural_work_requested: true }).outcome).toBe("declined");
  });
});
