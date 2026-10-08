import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeLead } from "../qualify/test-helpers";
import { INTAKE_FIELDS, intakeFromExtraction, intakeStatus } from "./sheet";

describe("intake sheet", () => {
  it("lists every required field as missing on an empty call, name first", () => {
    const s = intakeStatus({}, { askBudget: true });
    expect(s.next?.key).toBe("caller_name");
    expect(s.missing).toEqual(["caller_name", "intent", "what_work", "space_type", "locality", "pin", "size", "site_ready", "deadline", "decision_maker", "budget", "researched"]);
  });

  it("skips budget when ASK_BUDGET is off", () => {
    expect(intakeStatus({}, { askBudget: false }).missing).not.toContain("budget");
  });

  it("counts a field the caller couldn't answer as asked", () => {
    const s = intakeStatus({ caller_name: "A", not_known: ["pin", "budget"] }, { askBudget: true });
    expect(s.missing).not.toContain("pin");
    expect(s.missing).not.toContain("budget");
    expect(s.notKnown).toEqual(["pin", "budget"]);
  });

  it("requires a callback window only for review / redirect", () => {
    expect(intakeStatus({}, { askBudget: false }).missing).not.toContain("callback_window");
    expect(intakeStatus({}, { askBudget: false, outcome: "review" }).missing).toContain("callback_window");
  });

  it("reports what a stored extraction is missing", () => {
    const x = makeLead({ pin: null, decision_maker: "unknown", researched_us: "yes" });
    expect(intakeFromExtraction(x, { askBudget: false, outcome: "qualified" }).missing).toEqual(["pin", "decision_maker"]);
  });

  it("the generated doc is up to date", () => {
    const doc = readFileSync("docs/intake-sheet.md", "utf8");
    for (const f of INTAKE_FIELDS) expect(doc).toContain(f.question);
  });
});
