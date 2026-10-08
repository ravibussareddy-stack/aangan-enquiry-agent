import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import seedConfig from "../../db/seed/config.json";
import {
  findPriceMentions,
  parseLabelledTranscript,
  scanTranscriptForPriceLeak,
  type TranscriptTurn,
} from "./price-scan";

const agent = (text: string): TranscriptTurn => ({ speaker: "agent", text });
const caller = (text: string): TranscriptTurn => ({ speaker: "caller", text });

describe("findPriceMentions", () => {
  it.each([
    "That would be around ₹18 lakh",
    "Rates start at Rs. 1800",
    "INR 2,400 per sq ft",
    "typically 1,800 per square foot",
    "about twenty lakhs",
    "a 2BHK is usually a few lakh",
    "1.2 crore for the villa",
    "Isme lagbhag 5 लाख लगेंगे",
    "1800 रुपये प्रति वर्ग फुट",
    "around 2000 a sq ft",
  ])("flags: %s", (text) => {
    expect(findPriceMentions(text).length).toBeGreaterThan(0);
  });

  it.each([
    "About 1,400 sq ft carpet — got it.",
    "Your 3BHK in Kothrud, 1,100 square feet.",
    "I can book Thursday 11am or Saturday 10am.",
    "The consultation is free and there's no obligation.",
  ])("does not flag: %s", (text) => {
    expect(findPriceMentions(text)).toEqual([]);
  });

  it("the mandated deflection line itself is clean", () => {
    expect(findPriceMentions(seedConfig.PRICE_DEFLECTION_LINE.value)).toEqual([]);
  });
});

describe("scanTranscriptForPriceLeak", () => {
  it("ignores amounts spoken by the caller", () => {
    const r = scanTranscriptForPriceLeak([caller("My budget is 1 to 1.5 lakh"), agent("Thanks, noted.")]);
    expect(r.leak).toBe(false);
  });

  it("allows a short confirmation that echoes the caller's figure", () => {
    const r = scanTranscriptForPriceLeak([caller("Budget is around six lakh"), agent("Just to confirm — 6 lakh?")]);
    expect(r.leak).toBe(false);
    expect(r.echoes).toHaveLength(1);
  });

  it("flags an agent figure the caller never said", () => {
    const r = scanTranscriptForPriceLeak([caller("Budget is 6 lakh"), agent("Just to confirm — 16 lakh?")]);
    expect(r.leak).toBe(true);
  });

  it("flags an agent comparing the caller's budget to a figure", () => {
    const r = scanTranscriptForPriceLeak([
      caller("My budget is 1.5 lakh"),
      agent("Projects like this usually need at least 7 lakh, so 1.5 lakh would be too low."),
    ]);
    expect(r.leak).toBe(true);
  });

  it("flags per-sq-ft talk even inside a confirmation", () => {
    const r = scanTranscriptForPriceLeak([caller("Is it 1800 per sq ft?"), agent("1800 per sq ft, is that right?")]);
    expect(r.leak).toBe(true);
  });

  it("T10's front desk would be flagged — our agent must decline on budget without a figure", () => {
    const t10 = JSON.parse(readFileSync("eval/cases/T10.json", "utf8"));
    expect(scanTranscriptForPriceLeak(t10.transcript).leak).toBe(true);
  });

  it("finds no leaks in the other real front-desk transcripts", () => {
    for (const id of ["T01", "T02", "T13"]) {
      const kase = JSON.parse(readFileSync(`eval/cases/${id}.json`, "utf8"));
      expect(scanTranscriptForPriceLeak(kase.transcript).leak, id).toBe(false);
    }
  });
});

describe("parseLabelledTranscript", () => {
  it("parses AGENT/USER lines with optional timestamps", () => {
    const turns = parseLabelledTranscript("[00:00:01] AGENT: Hello\n[00:00:04] USER: Hi, price?\nnoise\nAGENT: Pricing depends…");
    expect(turns).toEqual([agent("Hello"), caller("Hi, price?"), agent("Pricing depends…")]);
  });
});

describe("budgetEchoed", () => {
  it("is true when the agent repeats the caller's figure (T10)", async () => {
    const { budgetEchoed } = await import("./price-scan");
    const t10 = JSON.parse(readFileSync("eval/cases/T10.json", "utf8"));
    expect(budgetEchoed(t10.transcript, 150_000)).toBe(true);
  });

  it("is false when the figure was never echoed, or a different one was", async () => {
    const { budgetEchoed } = await import("./price-scan");
    expect(budgetEchoed([caller("Budget is 6 lakh"), agent("Noted, thanks.")], 600_000)).toBe(false);
    expect(budgetEchoed([caller("Budget is 6 lakh"), agent("Just to confirm — 16 lakh?")], 600_000)).toBe(false);
    expect(budgetEchoed([caller("Budget is six lakh"), agent("Just to confirm, 6 lakh?")], 600_000)).toBe(true);
  });
});

describe("echo of a budget said earlier in the call", () => {
  it("allows confirming a figure the caller said two turns ago", () => {
    const r = scanTranscriptForPriceLeak([
      caller("My budget is 1 to 1.5 lakh maximum"),
      agent("Got it. Which PIN code?"),
      caller("411014"),
      agent("1 to 1.5 lakh maximum?"),
    ]);
    expect(r.leak).toBe(false);
  });
});
