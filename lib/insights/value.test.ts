import { describe, expect, it } from "vitest";
import { canonicalLocality, closeProbability, estimateProjectValue } from "./value";

const b = {
  residential_per_sqft_inr: { low: 1800, high: 2400 },
  per_room_inr: { low: 350000, high: 800000 },
  commercial_per_sqft_inr: { low: 1200, high: 1800 },
};
const none = { budget_inr: null, project_type: "residential", scope_kind: "full_home", carpet_sqft: null, rooms_in_scope: null, configuration: null };

describe("estimateProjectValue", () => {
  it("prefers the caller's own budget", () => {
    expect(estimateProjectValue({ ...none, budget_inr: 2000000, carpet_sqft: 900 }, b)).toEqual({ inr: 2000000, basis: "budget" });
  });
  it("uses the typical mid-range for a home's size", () => {
    expect(estimateProjectValue({ ...none, carpet_sqft: 900 }, b)).toEqual({ inr: 900 * 2100, basis: "typical" });
  });
  it("estimates size from BHK when no area was given", () => {
    expect(estimateProjectValue({ ...none, configuration: "2 BHK" }, b)?.inr).toBe(900 * 2100);
  });
  it("prices partial jobs per room and commercial per sq ft", () => {
    expect(estimateProjectValue({ ...none, scope_kind: "partial", rooms_in_scope: 2 }, b)?.inr).toBe(2 * 575000);
    expect(estimateProjectValue({ ...none, project_type: "commercial", carpet_sqft: 800 }, b)?.inr).toBe(800 * 1500);
  });
  it("returns null when there's nothing to go on", () => {
    expect(estimateProjectValue(none, b)).toBeNull();
  });
});

describe("closeProbability", () => {
  it("maps deal health to a bounded probability", () => {
    expect(closeProbability(85)).toBe(0.85);
    expect(closeProbability(100)).toBe(0.9);
    expect(closeProbability(0)).toBe(0.05);
    expect(closeProbability(null)).toBe(0.3);
  });
});

describe("canonicalLocality", () => {
  it("groups spellings of the same area under the named locality", () => {
    expect(canonicalLocality("Dahanukar Colony, Kothrud")).toBe("Kothrud");
    expect(canonicalLocality("Kothrud, Dahanukar Colony")).toBe("Kothrud");
    expect(canonicalLocality("baner")).toBe("Baner");
  });
  it("keeps unknown places and handles blanks", () => {
    expect(canonicalLocality("Nellore, Andhra Pradesh")).toBe("Nellore");
    expect(canonicalLocality(null)).toBe("Not given");
  });
});
