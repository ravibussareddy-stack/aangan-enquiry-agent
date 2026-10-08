/**
 * Write eval/labels.ts into the case files: `expected` + `fixture` into
 * eval/cases/Txx.json, and the synthetic cases as eval/cases/Sxx.json.
 *
 *   npm run eval:label
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LABELS, SYNTHETIC } from "../eval/labels";

const DIR = "eval/cases";

for (const [id, label] of Object.entries(LABELS)) {
  const path = join(DIR, `${id}.json`);
  const kase = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...kase, ...label }, null, 2) + "\n");
}

for (const s of SYNTHETIC) {
  const kase = {
    id: s.id,
    channel: "phone",
    synthetic: true,
    source: `synthetic — adapted from ${s.adapted_from}`,
    call_started_at: s.call_started_at,
    duration_s: null,
    transcript: s.transcript,
    expected: s.expected,
    fixture: s.fixture,
  };
  writeFileSync(join(DIR, `${s.id}.json`), JSON.stringify(kase, null, 2) + "\n");
}

console.log(`Labelled ${Object.keys(LABELS).length} real and ${SYNTHETIC.length} synthetic cases`);
