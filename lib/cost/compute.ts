/**
 * Usage → cost rows. Rates are never hard-coded: they come from the `rates`
 * table (effective-dated), looked up at the time of the call / insights run.
 */
export interface Rate {
  id?: string;
  component: string;
  unit: string;
  unit_rate_inr: number;
  effective_from: string;
}

export interface CostRow {
  component: "voice_minutes" | "telephony" | "sms" | "llm_dialogue" | "llm_extraction" | "gemini_insights";
  unit: string;
  units: number;
  unit_rate_inr: number;
  cost_inr: number;
  rate_id: string | null;
  raw_usage: unknown;
}

export function rateAt(rates: Rate[], component: string, unit: string, at: Date): Rate | null {
  return (
    rates
      .filter((r) => r.component === component && r.unit === unit && new Date(r.effective_from) <= at)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null
  );
}

function row(rates: Rate[], component: CostRow["component"], unit: string, units: number, at: Date, raw: unknown): CostRow {
  const r = rateAt(rates, component, unit, at);
  const unitRate = r ? Number(r.unit_rate_inr) : 0;
  return { component, unit, units, unit_rate_inr: unitRate, cost_inr: round(units * unitRate), rate_id: r?.id ?? null, raw_usage: raw };
}

function round(n: number) {
  return Math.round(n * 10000) / 10000;
}

export interface TokenUsage {
  prompt: number;
  /** Output incl. thinking tokens (Gemini bills thinking as output). */
  output: number;
}

export function llmCostRows(rates: Rate[], component: "llm_dialogue" | "llm_extraction" | "gemini_insights", usage: TokenUsage, at: Date, raw: unknown): CostRow[] {
  return [
    row(rates, component, "input_tokens_1m", usage.prompt / 1e6, at, raw),
    row(rates, component, "output_tokens_1m", usage.output / 1e6, at, raw),
  ];
}

export function callCostRows(
  rates: Rate[],
  input: {
    at: Date;
    billedMinutes: number;
    voiceRaw: unknown;
    dialogue?: TokenUsage;
    extraction?: TokenUsage;
    smsCount?: number;
  },
): CostRow[] {
  const rows: CostRow[] = [
    row(rates, "voice_minutes", "minute", input.billedMinutes, input.at, input.voiceRaw),
    row(rates, "telephony", "minute", input.billedMinutes, input.at, input.voiceRaw),
  ];
  if (input.dialogue) rows.push(...llmCostRows(rates, "llm_dialogue", input.dialogue, input.at, input.dialogue));
  if (input.extraction) rows.push(...llmCostRows(rates, "llm_extraction", input.extraction, input.at, input.extraction));
  if (input.smsCount) rows.push(row(rates, "sms", "message", input.smsCount, input.at, { count: input.smsCount }));
  return rows;
}
