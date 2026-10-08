import { describe, expect, it } from "vitest";
import rates from "../../db/seed/rates.json";
import { callCostRows, rateAt } from "./compute";

const at = new Date("2026-10-07T23:00:00+05:30");

describe("cost", () => {
  it("costs voice minutes from the rates table", () => {
    const rows = callCostRows(rates, { at, billedMinutes: 3, voiceRaw: {} });
    expect(rows.find((r) => r.component === "voice_minutes")?.cost_inr).toBe(15);
    expect(rows.find((r) => r.component === "telephony")?.cost_inr).toBe(0);
  });

  it("costs LLM tokens per million, thinking included in output", () => {
    const rows = callCostRows(rates, { at, billedMinutes: 1, voiceRaw: {}, dialogue: { prompt: 1_000_000, output: 100_000 } });
    const dlg = rows.filter((r) => r.component === "llm_dialogue");
    expect(dlg.map((r) => r.cost_inr)).toEqual([26.4, 22]);
  });

  it("uses the rate in effect at call time", () => {
    const later = [...rates, { component: "voice_minutes", unit: "minute", unit_rate_inr: 6, effective_from: "2026-11-01T00:00:00+05:30" }];
    expect(rateAt(later, "voice_minutes", "minute", at)?.unit_rate_inr).toBe(5);
    expect(rateAt(later, "voice_minutes", "minute", new Date("2026-11-02"))?.unit_rate_inr).toBe(6);
  });

  it("costs nothing (but still logs a row) when no rate exists", () => {
    const rows = callCostRows([], { at, billedMinutes: 2, voiceRaw: {} });
    expect(rows[0]).toMatchObject({ units: 2, cost_inr: 0, rate_id: null });
  });
});
