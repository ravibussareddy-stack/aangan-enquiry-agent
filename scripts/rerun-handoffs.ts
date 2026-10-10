/**
 * Re-run the post-call hand-off (HubSpot deal, staff email, booking SMS) for leads
 * whose hand-off never ran — e.g. the 9–10 Oct 2026 bug where an invalid SQL regex
 * made every hand-off fail. DRY RUN by default: lists the leads and changes nothing.
 *
 *   npm run handoffs:rerun                          # dry run, leads since 9 Oct 2026 14:00 UTC
 *   npm run handoffs:rerun -- --since 2026-10-09T14:00:00Z
 *   npm run handoffs:rerun -- --apply               # actually run them
 *
 * A lead counts as missed when it has no row in `handoffs` at all (the bug failed
 * before anything was sent, so re-running can't double-send).
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const apply = process.argv.includes("--apply");
const sinceArg = process.argv.indexOf("--since");
const since = sinceArg > 0 ? process.argv[sinceArg + 1] : "2026-10-09T14:00:00Z";

const { db } = await import("../lib/db/client");
const { runHandoff } = await import("../lib/handoff/run");

const { rows } = await db().query<{ id: string; name: string | null; status: string; created_at: string }>(
  `select l.id, l.name, l.status::text, l.created_at::text from leads l
    where l.created_at >= $1::timestamptz and not exists (select 1 from handoffs h where h.lead_id = l.id)
    order by l.created_at`,
  [since],
);
console.log(`${rows.length} lead(s) since ${since} with no hand-off:`);
for (const r of rows) console.log(`  ${r.created_at}  ${r.status.padEnd(10)}  ${r.name ?? "(no name)"}  ${r.id}`);
if (!apply) {
  console.log("\nDry run — nothing sent. Add --apply to run these hand-offs.");
  process.exit(0);
}
for (const r of rows) {
  try {
    await runHandoff(r.id);
    console.log(`✓ ${r.id}`);
  } catch (err) {
    console.log(`✗ ${r.id}: ${(err as Error).message}`);
  }
}
process.exit(0);
