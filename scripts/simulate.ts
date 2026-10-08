/**
 * Run text-simulated calls (no Vaani credit — Gemini plays the caller).
 *
 *   npm run sim -- T01 T13            # specific cases
 *   npm run sim -- --showcase         # the 5 review transcripts
 *   npm run sim -- T01 --at 2026-10-06T23:05:00+05:30
 *   npm run sim -- T01 --persist      # also run the post-call pipeline into Neon
 *
 * Writes eval/simulations/<id>.md (+ .json).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { personaFor } from "../eval/personas";
import { seedRuntimeConfig } from "../lib/config/runtime";
import { renderTranscript, simulateCall } from "../lib/sim/simulate";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export const SHOWCASE: { id: string; at: string; why: string }[] = [
  { id: "T01", at: "2026-10-06T23:05:00+05:30", why: "after-hours call (11 pm): qualify and book" },
  { id: "T13", at: "2026-10-06T12:19:00+05:30", why: "caller pushes hard for a price three times" },
  { id: "T10", at: "2026-10-06T14:04:00+05:30", why: "volunteered budget well below the floor → kind decline, no figure" },
  { id: "T09", at: "2026-10-06T11:32:00+05:30", why: "existing-client complaint → senior callback" },
  { id: "S07", at: "2026-10-07T10:45:00+05:30", why: "Hindi/English code-mixed caller" },
];

async function main() {
  const args = process.argv.slice(2);
  const atIdx = args.indexOf("--at");
  const at = atIdx > -1 ? args[atIdx + 1] : null;
  const persist = args.includes("--persist");
  const ids = args.includes("--showcase") ? SHOWCASE.map((s) => s.id) : args.filter((a, i) => !a.startsWith("--") && (atIdx < 0 || i !== atIdx + 1));
  if (!ids.length) throw new Error("Usage: npm run sim -- T01 [T02 …] | --showcase");

  const config = seedRuntimeConfig();
  mkdirSync("eval/simulations", { recursive: true });
  for (const [n, id] of ids.entries()) {
    const show = SHOWCASE.find((s) => s.id === id);
    const startAt = new Date(at ?? show?.at ?? new Date().toISOString());
    const result = await simulateCall(personaFor(id, n + 1), config, { startAt });
    const md = renderTranscript(result) + (show ? `\n_Why this case: ${show.why}._\n` : "");
    writeFileSync(`eval/simulations/${id}.md`, md);
    writeFileSync(`eval/simulations/${id}.json`, JSON.stringify({ ...result, state: { ...result.state, history: undefined } }, null, 2));
    const s = result.state;
    console.log(
      `${id}: ${s.evaluation?.outcome ?? s.scope?.status ?? "—"}${s.booking ? ` · booked ${s.booking.label}` : ""} · ${Math.round(result.durationS)}s · ${result.callerTurns} caller turns · guard rewrites ${s.guardRewrites.length}`,
    );
    if (persist) {
      const { persistSimulatedCall } = await import("../lib/calls/simulated");
      const leadId = await persistSimulatedCall(result);
      console.log(`  persisted → lead ${leadId}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
