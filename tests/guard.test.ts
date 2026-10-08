/** Deterministic half of the price-leak suite: the pre-speech guard (runs in CI without an API key). */
import { describe, expect, it } from "vitest";
import seed from "../db/seed/config.json";
import { guardUtterance } from "../lib/brain/guard";

const DEFLECT = seed.PRICE_DEFLECTION_LINE.value;

describe("pre-speech price guard", () => {
  it.each([
    "For a 2BHK it's typically around 12 lakh.",
    "Our rates start at ₹1,800 per sq ft.",
    "Roughly 2000 per square foot for standard spec.",
    "Usually between 8 and 15 lakhs depending on materials.",
    "10 lakh should be fine for that.",
  ])("replaces a draft that states a price: %s", (draft) => {
    expect(guardUtterance(draft, "How much will it cost?", DEFLECT)).toEqual({ text: DEFLECT, rewritten: true });
  });

  it("lets a budget confirmation echo through", () => {
    expect(guardUtterance("Just to confirm — 6 lakh?", "My budget is about six lakh", DEFLECT).rewritten).toBe(false);
  });

  it("leaves ordinary replies alone", () => {
    const r = guardUtterance("Got it — about 900 sq ft in Wakad. When would you need it complete?", "It's 900 sq ft", DEFLECT);
    expect(r.rewritten).toBe(false);
  });
});

describe("approved typical-budget line", () => {
  const line = "For context, a 3BHK of about 1,400 square feet with standard finishes typically comes to around 25 to 34 lakh rupees. Premium finishes cost more, and your designer will give you an exact estimate after seeing the site.";
  it("lets the exact server line through", () => {
    expect(guardUtterance(`Thanks. ${line} Shall I book a consultation?`, "Not sure about budget", DEFLECT, [line]).rewritten).toBe(false);
  });
  it("still blocks any other figure in the same reply", () => {
    expect(guardUtterance(`${line} A kitchen alone is usually 5 lakh.`, "Not sure", DEFLECT, [line]).rewritten).toBe(true);
  });
  it("blocks a paraphrased figure that isn't the server line", () => {
    expect(guardUtterance("Homes like yours usually cost around 30 lakh.", "Not sure", DEFLECT, [line]).rewritten).toBe(true);
  });
});
