/**
 * Mutation checks: prove the labelled cases would catch a wrong config.
 * If one of these starts failing, the eval has lost its teeth.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultQualifyConfig, evaluateLead } from "../lib/qualify";
import { LeadExtraction } from "../lib/schema/lead";

function load(id: string) {
  const c = JSON.parse(readFileSync(join(import.meta.dirname, "cases", `${id}.json`), "utf8"));
  return { fixture: LeadExtraction.parse(c.fixture), at: new Date(c.call_started_at) };
}

describe("eval catches bad config", () => {
  it("T10 flips from declined if BUDGET_REJECT_RATIO is set to 0.20", () => {
    const { fixture, at } = load("T10");
    expect(evaluateLead(fixture, defaultQualifyConfig(), at).outcome).toBe("declined");
    expect(evaluateLead(fixture, defaultQualifyConfig({ budgetRejectRatio: 0.2 }), at).outcome).not.toBe("declined");
  });

  it("T18 becomes a decline once the commercial minimum is confirmed", () => {
    const { fixture, at } = load("T18");
    const e = evaluateLead(fixture, defaultQualifyConfig({ commercialMinSqftMode: "decline" }), at);
    expect(e.outcome).toBe("declined");
    expect(e.declineReason).toBe("commercial_size");
  });

  it("T07 flips if the minimum lead time drops to 2 weeks", () => {
    const { fixture, at } = load("T07");
    expect(evaluateLead(fixture, defaultQualifyConfig({ minLeadWeeks: 2 }), at).outcome).not.toBe("declined");
  });
});
