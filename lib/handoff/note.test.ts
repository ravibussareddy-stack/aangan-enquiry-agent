import { describe, expect, it } from "vitest";
import { makeLead } from "../qualify/test-helpers";
import { buildNote } from "./note";

const base = {
  leadId: "11111111-2222-3333-4444-555555555555",
  phone: "+919876543210",
  calledAt: new Date("2026-10-06T23:05:00+05:30"),
  inArea: "in",
  budgetFlag: "not_given",
  flags: [],
  booking: { label: "Saturday, 10 October, 10 am", designer: "Asha Kulkarni" },
  summary: null,
  repeatCaller: false,
  dealUrl: "https://app.hubspot.com/contacts/1/record/0-3/9",
  transcriptUrl: "https://aangan.example/dashboard/leads/1",
};

describe("designer handoff note", () => {
  it("follows the brief's format, line by line", () => {
    const { text } = buildNote({ ...base, status: "qualified", extraction: makeLead() });
    const lines = text.split("\n");
    expect(lines[0]).toBe("NEW LEAD · Residential · Qualified");
    expect(lines[1]).toMatch(/^Priya · \+919876543210 · called 6 Oct/);
    expect(lines.map((l) => l.split(":")[0])).toEqual([
      "NEW LEAD · Residential · Qualified",
      lines[1].split(":")[0],
      "Site",
      "Scope",
      "Timeline",
      "Decision",
      "Budget",
      "Asked about price",
      "Booked",
      "Watch for",
    ]);
    expect(text).toContain("Booked: Saturday, 10 October, 10 am with Asha Kulkarni");
  });

  it("adds Approve/Reject only for review leads, and never leaks the budget floor", () => {
    const review = buildNote({ ...base, status: "review", booking: null, budgetFlag: "tight", extraction: makeLead({ budget_inr: 600000, budget_confirmed: true }) });
    expect(review.buttons[0].map((b) => b.data)).toEqual([`apr:${base.leadId}`, `rej:${base.leadId}`]);
    expect(review.text).toContain("Booked: awaiting review");
    expect(review.text).toContain("⚠ budget tight");
    expect(review.text).not.toMatch(/floor|25,20,000|1,800/);
    const qualified = buildNote({ ...base, status: "qualified", extraction: makeLead() });
    expect(qualified.buttons.flat().some((b) => b.data)).toBe(false);
  });

  it("formats complaints as URGENT for the senior group", () => {
    const { text } = buildNote({ ...base, status: "complaint", extraction: makeLead(), complaint: { summary: "Designer unresponsive for 5 days", wantsSenior: "Nikhil" } });
    expect(text.split("\n")[0]).toBe("URGENT · COMPLAINT · existing client");
    expect(text).toContain("Nikhil");
  });

  it("callback_data stays within Telegram's 64-byte limit", () => {
    const { buttons } = buildNote({ ...base, status: "review", booking: null, extraction: makeLead() });
    for (const b of buttons.flat()) if (b.data) expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64);
  });
});

describe("callback and deal health in notes", () => {
  it("formats a helpdesk callback note with what's missing and routing buttons", () => {
    const { text, buttons } = buildNote({ ...base, status: "callback", booking: null, extraction: makeLead({ locality: null }), missing: ["Locality", "Ballpark budget", "Decision-maker"], callbackWindow: "tomorrow after 4 pm" });
    expect(text.split("\n")[0]).toBe("CALLBACK NEEDED · Residential · helpdesk");
    expect(text).toContain("Free times: tomorrow after 4 pm");
    expect(text).toContain("as soon as possible");
    expect(text).toContain("Missing: Locality, Ballpark budget, Decision-maker");
    expect(buttons.flat().map((b) => b.data?.slice(0, 3)).filter(Boolean)).toEqual(["apr", "dsg", "adm", "rej"]);
  });

  it("adds the deal health line to qualified notes", () => {
    const { text } = buildNote({ ...base, status: "qualified", extraction: makeLead(), dealHealth: { score: 82, band: "high" } });
    expect(text).toContain("Deal health: 82/100 · High (est.)");
  });
});

describe("no promised call-back times", () => {
  it("complaint note says ASAP and records free times, never minutes", () => {
    const { text } = buildNote({ ...base, status: "complaint", extraction: makeLead(), complaint: { summary: "Designer unresponsive", wantsSenior: null }, callbackWindow: "weekday evenings" });
    expect(text).toContain("as soon as possible");
    expect(text).toContain("Free times: weekday evenings");
    expect(text).not.toMatch(/within \d+ minutes/);
  });
});

describe("live call 2026-10-09 fixes", () => {
  const live = makeLead({
    caller_name: "Ravi",
    configuration: "2BHK",
    scope_kind: "full_home",
    engagement: "design_and_execution",
    scope_text: "One my two BHK flat in Banar Pune. Fully designed and executed, the whole home.",
  });
  const note = buildNote({
    ...base,
    extraction: live,
    phone: "unknown",
    summary: "The call concluded with a scheduled meeting for Monday at 9 am.",
    booking: null,
  });

  it("shows a tidy scope, not raw speech-to-text, for a full home", () => {
    expect(note.text).toContain("Scope: 2BHK · full home · design + execution");
    expect(note.text).not.toContain("Banar");
  });

  it("says when there's no real number instead of printing 'unknown'", () => {
    expect(note.text).toContain("Ravi · number not available (web call or withheld)");
  });

  it("keeps the AI summary out of the facts, clearly labelled", () => {
    const watch = note.text.split("\n").find((l) => l.startsWith("Watch for:"))!;
    expect(watch).not.toMatch(/scheduled/);
    expect(note.text).toMatch(/\nAI call summary \(unverified — the lines above are the facts\): The call concluded/);
    expect(note.text).toContain("Booked: not yet");
  });
});
