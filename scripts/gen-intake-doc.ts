/** Generate docs/intake-sheet.md from lib/intake/sheet.ts (single source).  npm run docs:intake */
import { writeFileSync } from "node:fs";
import { INTAKE_FIELDS } from "../lib/intake/sheet";

const when = { always: "Always", if_ask_budget: "If ASK_BUDGET is on", if_review_or_redirect: "Review / redirect leads", optional: "Optional" };
const rows = INTAKE_FIELDS.map(
  (f, i) => `| ${i + 1} | **${f.label}** | ${f.question} | ${when[f.requirement]} | ${f.criterion ? f.criterion.replace("_", " ") : "—"} | ${f.why} |`,
);
const md = `# Phone enquiry intake sheet

_Generated from \`lib/intake/sheet.ts\` — edit there, then run \`npm run docs:intake\`._

Every enquiry call works through this sheet. Callers often don't volunteer details, so the agent asks for each field, combining two related questions where it sounds natural. The server tracks what's captured and won't let the agent decide while required fields are still unasked.

**If the caller doesn't know or won't say,** that's fine. The agent acknowledges it, marks the field "not known", and moves on. It never pushes or asks twice. To protect the 5-minute limit, the server sends the agent back for missing fields at most twice, and never after the 4:15 wrap-up point. Whatever is still missing goes to the designer as **"Not captured on the call: …"**.

**Never invented:** name, callback time, budget and dates must come from the caller's own words. The server rejects a callback time the caller didn't say.

| # | Field | What the agent asks | Required | Rubric criterion | Why it matters |
|---|---|---|---|---|---|
${rows.join("\n")}

## Shortcuts
- **Hard decline early:** if what they want is clearly out of scope (restaurant, gym, advice only, outside Pune/PCMC…), the agent closes politely without collecting the rest.
- **Existing-client complaint:** apologise, promise a senior callback within 15 minutes, escalate, end. No intake needed.
- **Price questions** never count against the caller and never get a figure.
`;
writeFileSync("docs/intake-sheet.md", md);
console.log("Wrote docs/intake-sheet.md");
