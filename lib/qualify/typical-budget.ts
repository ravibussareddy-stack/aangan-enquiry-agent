/**
 * Server-written "typical budget" line (SHARE_TYPICAL_BUDGET). Only this exact
 * text may carry a figure on a call: the agent is told to say it verbatim, the
 * pre-speech guard and post-call leak scan allow it and nothing else.
 * Figures come from TYPICAL_BUDGETS (server-only config, from pricing.md).
 */
import type { LeadExtraction } from "../schema/lead";

export interface TypicalBudgets {
  residential_per_sqft_inr: { low: number; high: number };
  per_room_inr: { low: number; high: number };
  commercial_per_sqft_inr: { low: number; high: number };
}

/** Rupees → spoken lakh, rounded to a sensible step ("25", "3.5"). */
function lakh(inr: number): string {
  const l = inr / 100000;
  const r = l >= 10 ? Math.round(l) : Math.round(l * 2) / 2;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

const close = "That's a typical range — it's indicative and depends on the locality and your requirements. Are you comfortable going ahead on that basis?";

/** The range itself, e.g. "a 3BHK of about 1,400 square feet comes to around 25 to 34 lakh rupees". */
export function typicalRange(x: Pick<LeadExtraction, "project_type" | "scope_kind" | "carpet_sqft" | "rooms_in_scope" | "configuration">, b: TypicalBudgets): string {
  const sqft = (n: number) => n.toLocaleString("en-IN");
  if (x.project_type === "commercial") {
    if (x.carpet_sqft) {
      return `an office fit-out of about ${sqft(x.carpet_sqft)} square feet comes to around ${lakh(x.carpet_sqft * b.commercial_per_sqft_inr.low)} to ${lakh(x.carpet_sqft * b.commercial_per_sqft_inr.high)} lakh rupees`;
    }
    return `office fit-outs start at around ${sqft(b.commercial_per_sqft_inr.low)} rupees per square foot`;
  }
  const rooms = x.scope_kind === "single_room" ? 1 : x.scope_kind === "partial" ? x.rooms_in_scope : null;
  if (rooms) {
    const what = rooms === 1 ? "a single room" : `${rooms} rooms`;
    return `redoing ${what} completely comes to around ${lakh(rooms * b.per_room_inr.low)} to ${lakh(rooms * b.per_room_inr.high)} lakh rupees`;
  }
  if (x.carpet_sqft) {
    const home = x.configuration ? `a ${x.configuration} of about ${sqft(x.carpet_sqft)} square feet` : `a home of about ${sqft(x.carpet_sqft)} square feet`;
    return `${home} comes to around ${lakh(x.carpet_sqft * b.residential_per_sqft_inr.low)} to ${lakh(x.carpet_sqft * b.residential_per_sqft_inr.high)} lakh rupees`;
  }
  return `full home interiors start at around ${sqft(b.residential_per_sqft_inr.low)} rupees per square foot of carpet area`;
}

/** First mention: range + disclaimer + comfort check. */
export function typicalBudgetLine(x: Parameters<typeof typicalRange>[0], b: TypicalBudgets): string {
  return `Typically, ${typicalRange(x, b)}. ${close}`;
}

/** Asked again / insisting: brief repeat, exact figure is the designer's. */
export function typicalBudgetRepeat(x: Parameters<typeof typicalRange>[0], b: TypicalBudgets): string {
  return `As I mentioned, typically ${typicalRange(x, b)} — it's indicative, and your designer will confirm the exact figure for your space at the consultation.`;
}
