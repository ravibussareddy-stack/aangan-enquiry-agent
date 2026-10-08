import { describe, expect, it } from "vitest";
import { ALLOWED_PINS, DENIED_PINS, REVIEW_PINS } from "./data/service-area";
import { resolveServiceArea } from "./service-area";

const area = (locality: string | null, pin: string | null = null, city: string | null = null) =>
  resolveServiceArea({ locality, pin, city }).status;

describe("service area", () => {
  it.each([
    "Kothrud",
    "Dahanukar Colony, Kothrud",
    "Pimple Saudagar",
    "Magarpatta — Cybercity area",
    "Koregaon Park",
    "vimannagar",
    "Hinjawadi Phase 1",
    "NIBM Road",
  ])("accepts %s", (locality) => {
    expect(area(locality)).toBe("in");
  });

  it("accepts Kharadi (not named in services.md, but Pune city — T10)", () => {
    expect(area("Kharadi")).toBe("in");
  });

  it.each(["Nashik", "Talegaon Dabhade", "Lonavala", "Mumbai", "Navi Mumbai", "Bangalore"])(
    "declines %s",
    (place) => {
      expect(area(place)).toBe("out");
    },
  );

  it("declines a non-Pune city given as the city", () => {
    expect(area("Andheri West", null, "Mumbai")).toBe("out");
  });

  it("accepts an allowlisted PIN on its own", () => {
    expect(area(null, "411045")).toBe("in");
  });

  it("declines a denylisted PIN when no locality is given", () => {
    expect(area(null, "410506")).toBe("out");
  });

  it("treats a denylisted PIN with an unrecognised locality as unclear (STT may have misheard)", () => {
    expect(area("Some Society", "410506")).toBe("unclear");
  });

  it("treats an allowed locality with a denied PIN as unclear", () => {
    expect(area("Kothrud", "410506")).toBe("unclear");
  });

  it.each([["Wagholi"], ["Pune"], ["Sunshine Hills"]])("treats %s as unclear, never out", (locality) => {
    expect(area(locality)).toBe("unclear");
  });

  it("treats no location as unclear", () => {
    expect(area(null)).toBe("unclear");
  });

  it("does not match place names inside other words", () => {
    // "Sus" is not allowlisted, and "Aundh" must not match "Aundhkar".
    expect(area("Aundhkar Heights, Sus")).toBe("unclear");
  });

  it("PIN lists are well-formed and disjoint", () => {
    const allowed = Object.keys(ALLOWED_PINS);
    const denied = Object.keys(DENIED_PINS);
    const review = Object.keys(REVIEW_PINS);
    for (const pin of [...allowed, ...denied, ...review]) expect(pin).toMatch(/^41[0-2]\d{3}$/);
    expect(allowed.filter((p) => denied.includes(p) || review.includes(p))).toEqual([]);
    expect(denied.filter((p) => review.includes(p))).toEqual([]);
  });
});
