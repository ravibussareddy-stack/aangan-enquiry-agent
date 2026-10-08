import { describe, expect, it } from "vitest";
import seed from "../../db/seed/config.json";
import { routeForInfo } from "./routing";

const rule = seed.INSUFFICIENT_INFO.value;

describe("insufficient-info routing", () => {
  it("sends a qualified lead missing 3 core fields to the helpdesk callback queue", () => {
    expect(routeForInfo({ outcome: "qualified", missing: ["locality", "deadline", "budget"], booked: false, rule }).status).toBe("callback");
  });

  it("keeps a lead with 2 missing core fields (or only non-core gaps) as is", () => {
    expect(routeForInfo({ outcome: "qualified", missing: ["deadline", "budget", "pin", "size"], booked: false, rule }).status).toBe("qualified");
  });

  it("never un-books a booked lead", () => {
    expect(routeForInfo({ outcome: "qualified", missing: ["locality", "deadline", "budget"], booked: true, rule }).status).toBe("qualified");
  });

  it("does not touch declines, complaints or redirects", () => {
    for (const outcome of ["declined", "complaint", "redirect"] as const) {
      expect(routeForInfo({ outcome, missing: rule.core_fields, booked: false, rule }).status).toBe(outcome);
    }
  });

  it("applies to review leads too", () => {
    expect(routeForInfo({ outcome: "review", missing: ["what_work", "locality", "budget"], booked: false, rule }).status).toBe("callback");
  });
});
