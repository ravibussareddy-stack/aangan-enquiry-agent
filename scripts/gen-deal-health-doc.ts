/** Generate docs/deal-health-rubric.md from lib/deal-health/score.ts.  npm run docs:deal-health */
import { writeFileSync } from "node:fs";
import seed from "../db/seed/config.json";
import { RUBRIC } from "../lib/deal-health/score";

const bands = seed.DEAL_HEALTH_BANDS.value;
const md = `# Deal health rubric

_Generated from \`lib/deal-health/score.ts\` — edit there, then run \`npm run docs:deal-health\`._

**What it is:** an estimate of how likely a **qualified or approved** lead is to become a won project. It is scored 0–100 and shown on the dashboard, on each lead, and in HubSpot as the deal's priority (High / Medium / Low).

**Cost:** zero. It's a fixed rubric over fields the call already captured, with no AI call per lead.

| Factor | Max points | How points are given |
|---|---|---|
${RUBRIC.map((r) => `| ${r.label} | ${r.max} | ${r.levels} |`).join("\n")}
| At risk (penalty) | −5 | Frustrated repeat caller who wasn't followed up |
| **Total** | **100** | |

**Bands:** High ≥ ${bands.high} · Medium ${bands.medium}–${bands.high - 1} · Low < ${bands.medium} (editable in Settings → DEAL_HEALTH_BANDS).

**Budget** is compared with the studio's internal floor, but only the verdict ("fits scope", "tight") is ever shown. The floor figure isn't.

**Calibration:** the weights are a starting point drawn from the September enquiries. In those, referrals, a decider on the call, and a clear timeline marked the strongest leads. Once Won/Lost outcomes come back from HubSpot, the dashboard shows the actual win rate for each band. If High doesn't win clearly more often than Low, adjust the weights.

**Recalculated** when a call is processed, when a review or callback lead is approved, and when a booking is made or changed.
`;
writeFileSync("docs/deal-health-rubric.md", md);
console.log("Wrote docs/deal-health-rubric.md");
