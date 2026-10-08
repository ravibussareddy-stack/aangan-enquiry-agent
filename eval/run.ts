/**
 * Eval runner.
 *
 *   npm run eval                 # fixture mode: golden extractions → evaluate_lead
 *   npm run eval -- --mode llm   # Phase 3: transcript → LLM extraction → evaluate_lead
 *
 * Exits non-zero if any labelled decline or complaint case flips, or (in
 * fixture mode, which is deterministic) on any mismatch at all.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defaultQualifyConfig, evaluateLead } from "../lib/qualify";
import { extractLead, type Turn } from "../lib/extract/extract";
import { LeadExtraction, LeadOutcome } from "../lib/schema/lead";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const CASES_DIR = join(import.meta.dirname, "cases");

const Case = z.object({
  id: z.string(),
  synthetic: z.boolean(),
  call_started_at: z.string(),
  expected: z.object({
    outcome: LeadOutcome.nullable(),
    decline_reason: z.string().optional(),
    acceptable: z.array(LeadOutcome).optional(),
    flags_include: z.array(z.string()).optional(),
    excluded: z.string().optional(),
    note: z.string().optional(),
  }),
  fixture: LeadExtraction.nullable(),
  transcript: z.array(z.object({ speaker: z.string(), text: z.string() })),
});
type Case = z.infer<typeof Case>;

interface Row {
  id: string;
  synthetic: boolean;
  expected: string;
  actual: string;
  ok: boolean;
  critical: boolean;
  problems: string[];
}

const OUTCOMES = LeadOutcome.options;

function parseArgs() {
  const i = process.argv.indexOf("--mode");
  return { mode: i > -1 ? process.argv[i + 1] : "fixture" };
}

function loadCases(): Case[] {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(readFileSync(join(CASES_DIR, f), "utf8"));
      const parsed = Case.safeParse(raw);
      if (!parsed.success) {
        throw new Error(`${f}: invalid case\n${z.prettifyError(parsed.error)}`);
      }
      return parsed.data;
    });
}

function confusion(rows: Row[], title: string) {
  if (!rows.length) return;
  const header = ["expected \\ actual", ...OUTCOMES];
  const lines = OUTCOMES.map((exp) => [
    exp,
    ...OUTCOMES.map((act) => String(rows.filter((r) => r.expected === exp && r.actual === act).length || ".")),
  ]);
  const width = Math.max(...[header, ...lines].flat().map((c) => c.length)) + 2;
  const correct = rows.filter((r) => r.ok).length;
  console.log(`\n${title}: ${correct}/${rows.length} correct (${((100 * correct) / rows.length).toFixed(0)}%)`);
  for (const line of [header, ...lines]) console.log(line.map((c) => c.padEnd(width)).join(""));
}

async function extractionFor(c: Case, mode: string): Promise<LeadExtraction> {
  if (mode === "fixture") {
    if (!c.fixture) throw new Error(`${c.id}: labelled but has no fixture`);
    return c.fixture;
  }
  const { extraction } = await extractLead(c.transcript as Turn[], new Date(c.call_started_at));
  return extraction;
}

async function main() {
  const { mode } = parseArgs();
  if (mode !== "fixture" && mode !== "llm") {
    console.error(`Unknown mode "${mode}" (fixture | llm)`);
    process.exit(2);
  }

  const cfg = defaultQualifyConfig();
  const rows: Row[] = [];
  const excluded: string[] = [];
  const cases = loadCases().filter((c) => {
    if (c.expected.excluded || !c.expected.outcome) {
      excluded.push(`${c.id}: ${c.expected.excluded ?? "no expected outcome"}`);
      return false;
    }
    return true;
  });

  // LLM mode: extract with a little concurrency (free-tier rate limits).
  const extractions = new Map<string, LeadExtraction>();
  const queue = [...cases];
  await Promise.all(
    Array.from({ length: mode === "llm" ? 3 : 1 }, async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        extractions.set(c.id, await extractionFor(c, mode));
      }
    }),
  );
  const calibration: { id: string; expected: string; inScope: number; oos: number }[] = [];

  for (const c of cases) {
    if (!c.expected.outcome) continue;
    const extraction = extractions.get(c.id)!;
    calibration.push({ id: c.id, expected: c.expected.outcome, inScope: extraction.in_scope_confidence, oos: extraction.out_of_scope_confidence });
    const e = evaluateLead(extraction, cfg, new Date(c.call_started_at));
    const problems: string[] = [];
    const acceptedAlt = mode === "llm" && (c.expected.acceptable ?? []).includes(e.outcome);
    if (e.outcome !== c.expected.outcome && !acceptedAlt) problems.push(`outcome ${e.outcome} ≠ ${c.expected.outcome}`);
    if (c.expected.decline_reason && e.outcome === "declined" && e.declineReason !== c.expected.decline_reason) {
      problems.push(`decline reason ${e.declineReason} ≠ ${c.expected.decline_reason}`);
    }
    for (const flag of c.expected.flags_include ?? []) {
      if (!e.flags.includes(flag as never)) problems.push(`missing flag ${flag}`);
    }
    const critical =
      (c.expected.outcome === "declined" || c.expected.outcome === "complaint") && e.outcome !== c.expected.outcome && !acceptedAlt;

    rows.push({
      id: c.id,
      synthetic: c.synthetic,
      expected: c.expected.outcome,
      actual: e.outcome,
      ok: problems.length === 0,
      critical,
      problems,
    });
    const mark = problems.length ? (critical ? "✗✗" : "✗ ") : "✓ ";
    const reason = e.declineReason ? ` (${e.declineReason})` : "";
    console.log(
      `${mark} ${c.id.padEnd(4)} ${c.expected.outcome.padEnd(10)} → ${(e.outcome + reason).padEnd(28)} ${e.flags.join(", ")}`,
    );
    for (const p of problems) console.log(`       ${p}`);
  }

  confusion(rows.filter((r) => !r.synthetic), `Real transcripts (T01–T20) — ${mode} mode`);
  confusion(rows.filter((r) => r.synthetic), "Synthetic cases");
  if (excluded.length) console.log(`\nExcluded: ${excluded.join("; ")}`);

  if (mode === "llm") {
    console.log(`\nCalibration (agent confidences vs label; SCOPE_THRESHOLD = ${cfg.scopeThreshold}):`);
    console.log("case  expected    in_scope  out_of_scope");
    for (const k of calibration) console.log(`${k.id.padEnd(5)} ${k.expected.padEnd(11)} ${k.inScope.toFixed(2).padStart(8)}  ${k.oos.toFixed(2).padStart(12)}`);
    mkdirSync(join(import.meta.dirname, "reports"), { recursive: true });
    writeFileSync(
      join(import.meta.dirname, "reports", `llm-${new Date().toISOString().slice(0, 10)}.json`),
      JSON.stringify({ rows, calibration, extractions: Object.fromEntries(extractions) }, null, 2),
    );
  }

  const critical = rows.filter((r) => r.critical);
  const mismatched = rows.filter((r) => !r.ok);
  if (critical.length) {
    console.error(`\nFAIL: labelled decline/complaint flipped: ${critical.map((r) => r.id).join(", ")}`);
    process.exit(1);
  }
  if (mode === "fixture" && mismatched.length) {
    console.error(`\nFAIL: fixture mode is deterministic, mismatches: ${mismatched.map((r) => r.id).join(", ")}`);
    process.exit(1);
  }
  console.log(mode === "llm" && mismatched.length ? `\nPASS (no critical flips; ${mismatched.length} non-critical mismatches)` : "\nPASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
