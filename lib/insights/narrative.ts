/**
 * Weekly narrative over the metrics snapshot (Gemini). Rules (brief §8):
 * numbers are computed in SQL first; Gemini only receives the aggregated JSON,
 * writes short claims, and each claim links to the panel it came from. Every
 * figure in a claim is checked against the snapshot — a claim whose figures
 * don't match is shown as unverified with the snapshot values instead.
 */
import { forget, memo } from "../cache/memo";
import { loadRuntimeConfig } from "../config/runtime";
import { llmCostRows, type Rate } from "../cost/compute";
import { db } from "../db/client";
import { generateJson } from "../llm/gemini";
import { getMetrics, type Metrics } from "./metrics";
import { detectSignals, type Signal } from "./signals";

export const INSIGHTS_PROMPT_VERSION = "insights-v1";
export const PANELS = ["pipeline", "overview", "funnel", "approvals", "deal_health", "bookings", "declines", "demand", "cost", "quality"] as const;

export interface Claim {
  text: string;
  panel: (typeof PANELS)[number];
  figures: number[];
  verified?: boolean;
}

const SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "One sentence, plain English, for the studio founder." },
          panel: { type: "string", enum: [...PANELS] },
          figures: { type: "array", items: { type: "number" }, description: "Every number used in the sentence, exactly as in the data." },
        },
        required: ["text", "panel", "figures"],
      },
    },
  },
  required: ["claims"],
};

const SYSTEM = `You write a short weekly briefing for the founder of Aangan Studio (interior design, Pune) about their AI phone enquiry agent.
You receive two JSON metric snapshots: this period and the previous period. Do NOT calculate anything new — only use numbers that appear in the data (you may quote either period's value). Percentages appear as fractions (0.25 = 25%); if you say "25%", put 0.25 in figures.
Write 3–6 claims covering, where the data supports it: the money first — business.pipeline (open pipeline value, weighted pipeline, value added this period). Quote money ONLY from business.pipeline.in_lakh, written as "₹X lakh" (e.g. "₹540.1 lakh"), never raw rupee amounts and business.captured_outside_staff (enquiries the AI took that staff couldn't); what changed vs last period; the biggest funnel drop (use funnel.biggest_drop exactly — don't pick your own); top decline reasons and what demand the studio is turning away; review-queue backlog; any spike in cost per booking or price-leak flags. One sentence each. If a period has no data, say so briefly rather than inventing trends.`;

function flatten(o: unknown, out: number[] = []): number[] {
  if (typeof o === "number") out.push(o);
  else if (Array.isArray(o)) o.forEach((x) => flatten(x, out));
  else if (o && typeof o === "object") Object.values(o).forEach((x) => flatten(x, out));
  return out;
}

export interface Recommendation {
  key: string;
  text: string;
  figures: number[];
  verified?: boolean;
}

const REC_SYSTEM = `You also write the founder's action list. You receive "signals": issues detected in the studio's live data, each with a key, a title, a reason and its figures.
Pick the 3 or 4 most valuable signals (they are already ranked by urgency) and write ONE short, natural imperative sentence for each — what to do and why it pays off for the business. Write like a sharp chief of staff: warm, plain English, units spelled out ("hours", not "h"), no jargon. Use only the figures given for that signal; never invent numbers, names or deadlines. Where a title contains {lead}, keep {lead} exactly as written (it stands for a customer's name). Return each with its exact key.`;

function recSchema(keys: string[]) {
  return {
    type: "object",
    properties: {
      recommendations: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: keys },
            text: { type: "string", description: "One imperative sentence for the founder." },
            figures: { type: "array", items: { type: "number" }, description: "Every number used, exactly as in that signal." },
          },
          required: ["key", "text", "figures"],
        },
      },
    },
    required: ["recommendations"],
  };
}

/** A recommendation's figures must all come from its own signal. */
export function verifyRecommendations(recs: Recommendation[], signals: Signal[]): Recommendation[] {
  return recs
    .filter((r) => signals.some((s) => s.key === r.key))
    .map((r) => {
      const allowed = signals.find((s) => s.key === r.key)!.figures;
      const inText = (r.text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
      const ok = [...r.figures, ...inText].every((f) => allowed.some((a) => Math.abs(a - f) < 0.5));
      return { ...r, verified: ok };
    });
}

export function verifyClaims(claims: Claim[], ...snapshots: Metrics[]): Claim[] {
  const known = snapshots.flatMap((s) => flatten(s));
  const matches = (f: number) =>
    known.some((k) => Math.abs(k - f) < 0.006 || Math.abs(k * 100 - f) < 0.6 || Math.abs(k - f) / Math.max(1, Math.abs(k)) < 0.006);
  return claims.map((c) => ({ ...c, verified: c.figures.every(matches) }));
}

export async function runInsights(opts: { to?: Date; triggeredBy: "cron" | "refresh"; includeSimulated?: boolean }) {
  const cfg = await loadRuntimeConfig();
  if (opts.triggeredBy === "refresh") {
    const { rows } = await db().query<{ n: number }>(
      "select count(*)::int n from insights where triggered_by = 'refresh' and created_at > now() - interval '1 day'",
    );
    if (rows[0].n >= cfg.insightsRefreshDailyLimit) throw new Error(`Refresh limit reached (${cfg.insightsRefreshDailyLimit}/day)`);
  }
  const to = opts.to ?? new Date();
  const from = new Date(to.getTime() - 7 * 86_400_000);
  const prevFrom = new Date(from.getTime() - 7 * 86_400_000);
  const includeSimulated = opts.includeSimulated ?? true;
  const [currentFull, previousFull] = await Promise.all([
    getMetrics({ from, to, includeSimulated }),
    getMetrics({ from: prevFrom, to: from, includeSimulated }),
  ]);
  // Only aggregates go to Gemini — no individual leads' names.
  const aggregate = (m: Metrics): Metrics => ({
    ...m,
    business: { ...m.business, pipeline: { ...m.business.pipeline, top: [] } },
    deal_health: { ...m.deal_health, open_deals: [] },
  });
  const current = aggregate(currentFull);
  const previous = aggregate(previousFull);

  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite";
  const { value, response } = await generateJson<{ claims: Claim[] }>({
    model,
    system: SYSTEM,
    contents: [{ role: "user", parts: [{ text: JSON.stringify({ this_period: current, previous_period: previous }) }] }],
    responseJsonSchema: SCHEMA,
    temperature: 0.2,
    thinkingLevel: "low",
  });
  const claims = verifyClaims(value.claims ?? [], current, previous);

  // Recommendations: Gemini phrases the top detected signals (no customer names — {lead} placeholders).
  const signals = await detectSignals().catch(() => [] as Signal[]);
  let recommendations: Recommendation[] = [];
  let recUsage = { promptTokenCount: 0, candidatesTokenCount: 0, thoughtsTokenCount: 0 };
  if (signals.length) {
    const recRes = await generateJson<{ recommendations: Recommendation[] }>({
      model,
      system: REC_SYSTEM,
      contents: [{ role: "user", parts: [{ text: JSON.stringify({ signals: signals.slice(0, 8).map(({ key, title, why, figures }) => ({ key, title, why, figures })) }) }] }],
      responseJsonSchema: recSchema(signals.slice(0, 8).map((s) => s.key)),
      temperature: 0.3,
      thinkingLevel: "low",
    }).catch(() => null);
    if (recRes) {
      recommendations = verifyRecommendations(recRes.value.recommendations ?? [], signals).filter((r) => r.verified);
      recUsage = recRes.response.usage;
    }
  }

  const rates = (await db().query<Rate>("select id, component, unit, unit_rate_inr::float8 as unit_rate_inr, effective_from::text from rates")).rows;
  const usage = {
    prompt: response.usage.promptTokenCount + recUsage.promptTokenCount,
    output: response.usage.candidatesTokenCount + response.usage.thoughtsTokenCount + recUsage.candidatesTokenCount + recUsage.thoughtsTokenCount,
  };
  const costRows = llmCostRows(rates, "gemini_insights", usage, new Date(), response.usage);
  const costInr = costRows.reduce((s, r) => s + r.cost_inr, 0);

  const ins = await db().query<{ id: string }>(
    `insert into insights (period_start, period_end, metrics_snapshot, narrative, model, cost_inr, triggered_by, recommendations)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [from, to, JSON.stringify({ current, previous, prompt_version: INSIGHTS_PROMPT_VERSION }), JSON.stringify(claims), response.model, costInr, opts.triggeredBy, JSON.stringify(recommendations)],
  );
  for (const r of costRows) {
    await db().query(
      "insert into call_costs (insight_id, component, unit, units, unit_rate_inr, cost_inr, rate_id, raw_usage) values ($1,$2,$3,$4,$5,$6,$7,$8)",
      [ins.rows[0].id, r.component, r.unit, r.units, r.unit_rate_inr, r.cost_inr, r.rate_id, JSON.stringify(r.raw_usage)],
    );
  }
  forget("insights:");
  return { id: ins.rows[0].id, claims, recommendations, costInr };
}

export function latestInsights() {
  return memo("insights:latest", 30_000, loadLatestInsights);
}

async function loadLatestInsights() {
  const { rows } = await db().query<{ id: string; narrative: Claim[]; recommendations: Recommendation[]; metrics_snapshot: { current: Metrics }; created_at: string; model: string; cost_inr: number; triggered_by: string }>(
    "select id, narrative, recommendations, metrics_snapshot, created_at::text, model, cost_inr::float8 as cost_inr, triggered_by from insights order by created_at desc limit 1",
  );
  return rows[0] ?? null;
}
