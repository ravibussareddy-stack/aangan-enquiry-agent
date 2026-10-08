import { describe, expect, it } from "vitest";
import { verifyClaims, type Claim } from "./narrative";
import type { Metrics } from "./metrics";

const snap = { overview: { total_calls: 42, after_hours_share: 0.31 }, cost: { per_booking_inr: 18.25 } } as unknown as Metrics;

describe("insight claim verification", () => {
  it("accepts figures that appear in the snapshot (incl. % of a fraction and rounding)", () => {
    const claims: Claim[] = [{ text: "42 calls, 31% after hours, ₹18.3 per booking", panel: "overview", figures: [42, 31, 18.25] }];
    expect(verifyClaims(claims, snap)[0].verified).toBe(true);
  });

  it("flags a figure Gemini computed or invented", () => {
    const claims: Claim[] = [{ text: "Calls up 50%", panel: "overview", figures: [50] }];
    expect(verifyClaims(claims, snap)[0].verified).toBe(false);
  });
});
