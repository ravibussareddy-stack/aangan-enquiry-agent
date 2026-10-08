import { describe, expect, it } from "vitest";
import { makeLead } from "../qualify/test-helpers";
import { RUBRIC, scoreDeal } from "./score";

const pass = { status: "pass" as const, floor: { floorInr: 1, basis: "residential_sqft" as const }, ratio: 1.2 };
const notGiven = { status: "not_given" as const, floor: null, ratio: null };

describe("deal health rubric", () => {
  it("weights sum to 100", () => {
    expect(RUBRIC.reduce((s, r) => s + r.max, 0)).toBe(100);
  });

  it("a strong, booked, referred lead scores High", () => {
    const h = scoreDeal({
      extraction: makeLead({ researched_us: "yes", referral: "Shruti Joshi (past client)", wants_site_visit: true }),
      budget: pass,
      booked: true,
      missingFields: 0,
      weeksToDeadline: 20,
      weeksToSite: null,
    });
    expect(h.score).toBe(100);
    expect(h.band).toBe("high");
  });

  it("a thin lead with no budget, no booking and an unknown decider scores Low", () => {
    const h = scoreDeal({
      extraction: makeLead({ decision_maker: "unknown", scope_kind: "single_room", timeline_text: null, completion_by: null, site_state: null }),
      budget: notGiven,
      booked: false,
      missingFields: 3,
      weeksToDeadline: null,
      weeksToSite: null,
    });
    expect(h.band).toBe("low");
    expect(h.score).toBeLessThan(45);
  });

  it("never exposes the budget floor figure in reasons", () => {
    const h = scoreDeal({ extraction: makeLead({ budget_inr: 600000 }), budget: { status: "tight", floor: { floorInr: 700000, basis: "per_room" }, ratio: 0.86 }, booked: false, missingFields: 0, weeksToDeadline: 10, weeksToSite: null });
    expect(JSON.stringify(h)).not.toMatch(/700000|7,00,000|floor/i);
  });

  it("penalises a frustrated repeat caller", () => {
    const base = { budget: pass, booked: true, missingFields: 0, weeksToDeadline: 20, weeksToSite: null };
    const calm = scoreDeal({ extraction: makeLead(), ...base });
    const upset = scoreDeal({ extraction: makeLead({ frustrated: true, repeat_caller: true }), ...base });
    expect(calm.score - upset.score).toBe(5);
  });
});
