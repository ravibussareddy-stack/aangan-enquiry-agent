import { describe, expect, it } from "vitest";
import { budgetGate, computeBudgetFloor } from "./budget";
import { defaultQualifyConfig } from "./config";
import { makeLead } from "./test-helpers";

const cfg = defaultQualifyConfig();

describe("budget floor", () => {
  it("full home: carpet sq ft × ₹1,800", () => {
    expect(computeBudgetFloor(makeLead({ carpet_sqft: 1400 }), cfg)).toEqual({
      floorInr: 2_520_000,
      basis: "residential_sqft",
    });
  });

  it("partial with rooms named: rooms × ₹3.5 lakh, ignoring whole-flat sq ft (T10)", () => {
    const t10 = makeLead({ scope_kind: "partial", rooms_in_scope: 2, carpet_sqft: 550 });
    expect(computeBudgetFloor(t10, cfg)).toEqual({ floorInr: 700_000, basis: "per_room" });
  });

  it("single room: ₹3.5 lakh", () => {
    const lead = makeLead({ scope_kind: "single_room", rooms_in_scope: null });
    expect(computeBudgetFloor(lead, cfg)?.floorInr).toBe(350_000);
  });

  it("partial with only an area: area × ₹1,800", () => {
    const lead = makeLead({ scope_kind: "partial", rooms_in_scope: null, carpet_sqft: 600 });
    expect(computeBudgetFloor(lead, cfg)).toEqual({ floorInr: 1_080_000, basis: "residential_sqft" });
  });

  it("commercial: sq ft × ₹1,200", () => {
    const lead = makeLead({ project_type: "commercial", category: "office", scope_kind: "commercial_fitout", carpet_sqft: 800 });
    expect(computeBudgetFloor(lead, cfg)).toEqual({ floorInr: 960_000, basis: "commercial_sqft" });
  });

  it("returns null without enough information", () => {
    expect(computeBudgetFloor(makeLead({ carpet_sqft: null }), cfg)).toBeNull();
    expect(computeBudgetFloor(makeLead({ project_type: "unknown" }), cfg)).toBeNull();
  });
});

describe("budget gate", () => {
  const t10 = (budget_inr: number | null) =>
    makeLead({ scope_kind: "partial", rooms_in_scope: 2, carpet_sqft: 550, budget_inr, budget_confirmed: true });

  it("rejects T10: ₹1.5 lakh against a ₹7 lakh floor", () => {
    const r = budgetGate(t10(150_000), cfg);
    expect(r.status).toBe("fail");
    expect(r.ratio).toBeCloseTo(0.214, 3);
  });

  it("would wrongly pass T10 at a 0.20 reject ratio — which is why the default is 0.70", () => {
    expect(budgetGate(t10(150_000), defaultQualifyConfig({ budgetRejectRatio: 0.2 })).status).toBe("tight");
  });

  it("is tight between the reject line and the floor", () => {
    expect(budgetGate(t10(490_000), cfg).status).toBe("tight"); // 0.70 × floor exactly
    expect(budgetGate(t10(699_999), cfg).status).toBe("tight");
  });

  it("fails just under the reject line", () => {
    expect(budgetGate(t10(489_999), cfg).status).toBe("fail");
  });

  it("passes at or above the floor", () => {
    expect(budgetGate(t10(700_000), cfg).status).toBe("pass");
  });

  it("passes when no budget is given", () => {
    expect(budgetGate(t10(null), cfg).status).toBe("not_given");
  });

  it("does not judge a budget when there is no floor", () => {
    expect(budgetGate(makeLead({ carpet_sqft: null, budget_inr: 100_000 }), cfg).status).toBe("no_floor");
  });
});
