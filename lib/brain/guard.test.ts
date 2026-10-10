import { describe, expect, it } from "vitest";
import { guardUtterance } from "./guard";

const DEFLECT = "Pricing depends on the site, the materials you choose, and the scope — your designer will walk you through it in detail at the consultation.";

describe("guardUtterance", () => {
  it("passes a clean reply through untouched", () => {
    expect(guardUtterance("Would Monday at 11 am work?", null, DEFLECT)).toEqual({ text: "Would Monday at 11 am work?", rewritten: false });
  });

  it("lets the agent restate the caller's own budget (live call 2026-10-10)", () => {
    const r = guardUtterance("Great, around 25 lakhs noted. I can book a consultation — would Monday at 11 am work?", ["I have a budget of around 25 lakhs."], DEFLECT);
    expect(r.rewritten).toBe(false);
  });

  it("drops only the sentence with a new figure and keeps the booking offer", () => {
    const r = guardUtterance("A 3BHK usually costs around 30 lakh. I can book a consultation — would Monday at 11 am work?", ["Full home in Kothrud."], DEFLECT);
    expect(r).toEqual({ text: "I can book a consultation — would Monday at 11 am work?", rewritten: true });
  });

  it("falls back to the deflection line when nothing safe is left", () => {
    const r = guardUtterance("It's about ₹2,000 per sq ft.", null, DEFLECT);
    expect(r).toEqual({ text: DEFLECT, rewritten: true });
  });

  it("keeps a multi-sentence approved line whole", () => {
    const line = "Typically a 3BHK of this size comes to ₹21–29 lakh. That's indicative only; your designer confirms the exact figure.";
    const r = guardUtterance(`${line} Are you comfortable with that range?`, null, DEFLECT, [line]);
    expect(r.rewritten).toBe(false);
  });
});
