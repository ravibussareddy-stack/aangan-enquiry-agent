import { describe, expect, it } from "vitest";
import { defaultQualifyConfig } from "./config";
import { evaluateLead } from "./evaluate";
import { CALL_AT, makeLead } from "./test-helpers";
import type { LeadExtraction } from "../schema/lead";

const cfg = defaultQualifyConfig();
const evaluate = (overrides: Partial<LeadExtraction> = {}, config = cfg) =>
  evaluateLead(makeLead(overrides), config, CALL_AT);

const fail = (evidence: string) => ({ verdict: "fail" as const, evidence });
const unclear = { verdict: "unclear" as const, evidence: "" };

describe("decision bands", () => {
  it("qualifies a clean lead", () => {
    const e = evaluate();
    expect(e.outcome).toBe("qualified");
    expect(e.declineReason).toBeNull();
  });

  it("qualifies at exactly the in-scope threshold", () => {
    expect(evaluate({ in_scope_confidence: 0.8 }).outcome).toBe("qualified");
  });

  it("sends anything below the in-scope threshold to review", () => {
    expect(evaluate({ in_scope_confidence: 0.79 }).outcome).toBe("review");
  });

  it("declines at exactly the out-of-scope threshold", () => {
    const e = evaluate({ category: "other", project_type: "commercial", carpet_sqft: 1000, out_of_scope_confidence: 0.8, in_scope_confidence: 0.1 });
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("out_of_scope");
  });

  it("does not auto-decline just below the out-of-scope threshold", () => {
    expect(evaluate({ category: "other", project_type: "commercial", carpet_sqft: 1000, out_of_scope_confidence: 0.79, in_scope_confidence: 0.2 }).outcome).toBe("review");
  });

  it("does not let a self-reported out-of-scope number decline a structurally in-scope home (S05 regression)", () => {
    const e = evaluate({ out_of_scope_confidence: 1, in_scope_confidence: 1 });
    expect(e.outcome).toBe("qualified");
    expect(e.flags).toContain("oos_confidence_contradicted");
  });

  it("uses SCOPE_THRESHOLD from config", () => {
    const strict = defaultQualifyConfig({ scopeThreshold: 0.95 });
    expect(evaluate({ in_scope_confidence: 0.9 }, strict).outcome).toBe("review");
  });

  it("lets a hard rule override a confident agent", () => {
    const e = evaluate({ locality: "Nashik", city: null, in_scope_confidence: 0.99 });
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("area");
    expect(e.criteria.area).toMatchObject({ verdict: "fail", source: "server" });
  });

  it("overrides the agent's area verdict with the server's", () => {
    const e = evaluate({
      criteria: { ...makeLead().criteria, area: fail("agent thought it was far") },
    });
    expect(e.outcome).toBe("qualified");
    expect(e.criteria.area.source).toBe("server");
  });

  it("routes complaints first, even when a hard rule would fail", () => {
    expect(evaluate({ complaint_detected: true, category: "restaurant" }).outcome).toBe("complaint");
  });

  it("declines when two or more criteria fail", () => {
    const e = evaluate({
      engagement: "unknown",
      decision_maker: "unknown",
      criteria: {
        ...makeLead().criteria,
        real_project: fail("Just looking for ideas"),
        decision_maker: fail("Researching for in-laws"),
      },
      in_scope_confidence: 0.4,
    });
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("multiple_criteria");
  });

  it("sends a single soft criterion failure to review, not decline", () => {
    const e = evaluate({ decision_maker: "unknown", criteria: { ...makeLead().criteria, decision_maker: fail("Not authorised") } });
    expect(e.outcome).toBe("review");
  });

  it("redirects a caller unsure whether they want a project", () => {
    expect(evaluate({ unsure_intent: true }).outcome).toBe("redirect");
  });

  it("declines advice-only even if the caller is also just exploring (T04)", () => {
    const e = evaluate({ unsure_intent: true, engagement: "advice_only" });
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("engagement");
  });
});

describe("unclear criteria", () => {
  it("sends an unclear area to review and asks about it", () => {
    const e = evaluate({ locality: "Wagholi", city: null });
    expect(e.outcome).toBe("review");
    expect(e.askNext).toBe("area");
    expect(e.flags).toContain("area_unclear");
  });

  it("does not block on unclear decision-maker (criterion 5) — qualifies with a flag", () => {
    const e = evaluate({
      decision_maker: "on_behalf_unconfirmed",
      decision_maker_note: "Son calling for parents",
      criteria: { ...makeLead().criteria, decision_maker: unclear },
    });
    expect(e.outcome).toBe("qualified");
    expect(e.flags).toContain("decision_maker_unclear");
  });

  it("does not block on a missing budget (criterion 4)", () => {
    const e = evaluate({ budget_inr: null });
    expect(e.outcome).toBe("qualified");
    expect(e.flags).toContain("budget_not_given");
  });

  it("asks about scope when the engagement is unknown", () => {
    const e = evaluate({ engagement: "unknown", criteria: { ...makeLead().criteria, real_project: unclear } });
    expect(e.outcome).toBe("review");
    expect(e.askNext).toBe("real_project");
  });
});

describe("budget gate inside the bands", () => {
  const t10 = { scope_kind: "partial" as const, rooms_in_scope: 2, carpet_sqft: 550, locality: "Kharadi" };

  it("declines a confirmed budget below the reject line", () => {
    const e = evaluate({ ...t10, budget_inr: 150_000, budget_confirmed: true });
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("budget");
  });

  it("does not decline on a budget that was never confirmed back (STT risk)", () => {
    const e = evaluate({ ...t10, budget_inr: 150_000, budget_confirmed: false });
    expect(e.outcome).toBe("review");
    expect(e.flags).toContain("budget_unconfirmed");
  });

  it("qualifies a tight budget with a flag", () => {
    const e = evaluate({ ...t10, budget_inr: 600_000, budget_confirmed: true });
    expect(e.outcome).toBe("qualified");
    expect(e.flags).toContain("budget_tight");
  });

  it("never rejects a review lead on budget", () => {
    const e = evaluate({ ...t10, budget_inr: 150_000, budget_confirmed: true, in_scope_confidence: 0.5 });
    expect(e.outcome).toBe("review");
  });
});

describe("commercial minimum", () => {
  it("sends a 180 sq ft pod to review with a flag (T18)", () => {
    const e = evaluate({
      project_type: "commercial",
      category: "coworking",
      scope_kind: "commercial_fitout",
      carpet_sqft: 180,
    });
    expect(e.outcome).toBe("review");
    expect(e.flags).toContain("commercial_below_min");
  });
});

describe("fixes from the first LLM eval run", () => {
  it("keeps the agent's timeline fail when the server couldn't resolve a date (T07 'before Diwali')", () => {
    const e = evaluate({
      completion_by: null,
      timeline_text: "Before Diwali",
      criteria: { ...makeLead().criteria, timeline: fail("before Diwali — three weeks away") },
    });
    expect(e.criteria.timeline).toMatchObject({ verdict: "fail", source: "agent" });
    expect(e.outcome).toBe("review");
  });

  it("does not let an agent 'fail' on timeline override a resolved, passing date", () => {
    const e = evaluate({ criteria: { ...makeLead().criteria, timeline: fail("worried") } });
    expect(e.criteria.timeline.source).toBe("server");
    expect(e.outcome).toBe("qualified");
  });

  it("treats a decision-maker never discussed as unclear (flagged), even if the agent said pass", () => {
    const e = evaluate({ decision_maker: "unknown" });
    expect(e.criteria.decision_maker.verdict).toBe("unclear");
    expect(e.flags).toContain("decision_maker_unclear");
    expect(e.outcome).toBe("qualified");
  });

  it("sends an unsure caller who also fails a criterion to review, not redirect", () => {
    const e = evaluate({
      unsure_intent: true,
      decision_maker: "unknown",
      criteria: { ...makeLead().criteria, decision_maker: fail("not authorised") },
    });
    expect(e.outcome).toBe("review");
  });
});

describe("redirect with 'just exploring'", () => {
  it("still redirects when the only failed criterion is real_project", () => {
    const e = evaluate({
      unsure_intent: true,
      engagement: "unknown",
      criteria: { ...makeLead().criteria, real_project: fail("just exploring") },
    });
    expect(e.outcome).toBe("redirect");
  });
});
