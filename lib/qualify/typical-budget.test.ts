import { describe, expect, it } from "vitest";
import seed from "../../db/seed/config.json";
import { typicalBudgetLine, typicalBudgetRepeat } from "./typical-budget";

const b = seed.TYPICAL_BUDGETS.value;

describe("typical budget line", () => {
  it("full home from carpet area", () => {
    expect(typicalBudgetLine({ project_type: "residential", scope_kind: "full_home", carpet_sqft: 1400, rooms_in_scope: null, configuration: "3BHK" }, b)).toContain(
      "Typically, a 3BHK of about 1,400 square feet comes to around 25 to 34 lakh rupees",
    );
  });

  it("rooms for partial projects", () => {
    expect(typicalBudgetLine({ project_type: "residential", scope_kind: "partial", carpet_sqft: 550, rooms_in_scope: 2, configuration: "1BHK" }, b)).toContain("redoing 2 rooms completely");
    expect(typicalBudgetLine({ project_type: "residential", scope_kind: "partial", carpet_sqft: 550, rooms_in_scope: 2, configuration: "1BHK" }, b)).toContain("7 to 16 lakh rupees");
  });

  it("commercial by area, and a per-sq-ft fallback when size is unknown", () => {
    expect(typicalBudgetLine({ project_type: "commercial", scope_kind: "commercial_fitout", carpet_sqft: 180, rooms_in_scope: null, configuration: null }, b)).toContain("around 2 to 3 lakh rupees");
    expect(typicalBudgetLine({ project_type: "residential", scope_kind: "full_home", carpet_sqft: null, rooms_in_scope: null, configuration: null }, b)).toContain("1,800 rupees per square foot");
  });

  it("is brief: the range, that it depends on locality and requirements, and a comfort check", () => {
    const line = typicalBudgetLine({ project_type: "residential", scope_kind: "single_room", carpet_sqft: null, rooms_in_scope: null, configuration: null }, b);
    expect(line).toMatch(/indicative and depends on the locality and your requirements\. Are you comfortable going ahead on that basis\?$/);
    expect(line.split(/[.?]\s/).length).toBeLessThanOrEqual(4);
  });
});

describe("repeat when the caller asks again", () => {
  it("restates the same range briefly and sends the exact figure to the designer", () => {
    const x = { project_type: "residential" as const, scope_kind: "full_home" as const, carpet_sqft: 1100, rooms_in_scope: null, configuration: "3BHK" };
    const r = typicalBudgetRepeat(x, b);
    expect(r).toContain("a 3BHK of about 1,100 square feet comes to around 20 to 26 lakh rupees");
    expect(r).toMatch(/designer will confirm the exact figure/);
    expect(r).not.toMatch(/comfortable/);
  });
});
