/**
 * One-off: set up the HubSpot deals pipeline stages the app expects
 * (lib/crm/types.ts DEAL_STAGES). DRY RUN by default — prints the plan and
 * changes nothing. With --apply it renames the 7 default stages and adds
 * "Consultation held" and "Declined".
 *
 *   npm run hubspot:stages              # dry run
 *   npm run hubspot:stages -- --apply
 *
 * Needs the crm.schemas.deals.write scope on the service key (remove it after).
 */
import { existsSync } from "node:fs";
import { DEAL_STAGES } from "../lib/crm/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const token = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
if (!token) throw new Error("HUBSPOT_PRIVATE_APP_TOKEN is not set in .env.local");
const pipeline = process.env.HUBSPOT_PIPELINE_ID || "default";
const apply = process.argv.includes("--apply");

// Default HubSpot stage id → our label. null id = new stage. Won/Lost keep HubSpot's closed-won/lost meaning.
const PLAN: { id: string | null; label: (typeof DEAL_STAGES)[number]; probability: string; closed: boolean }[] = [
  { id: "appointmentscheduled", label: "New qualified", probability: "0.2", closed: false },
  { id: "qualifiedtobuy", label: "Callback needed", probability: "0.1", closed: false },
  { id: "presentationscheduled", label: "Service review", probability: "0.3", closed: false },
  { id: "decisionmakerboughtin", label: "Admin review", probability: "0.3", closed: false },
  { id: "contractsent", label: "Booked", probability: "0.5", closed: false },
  { id: null, label: "Consultation held", probability: "0.7", closed: false },
  { id: "closedwon", label: "Won", probability: "1.0", closed: true },
  { id: "closedlost", label: "Lost", probability: "0.0", closed: true },
  { id: null, label: "Declined", probability: "0.0", closed: true },
];

async function hs<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.hubapi.com${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(json as { message?: string }).message ?? ""}`);
  return json as T;
}

type Stage = { id: string; label: string; displayOrder: number };

async function main() {
  const current = await hs<{ stages: Stage[] }>("GET", `/crm/v3/pipelines/deals/${pipeline}`);
  const byId = new Map(current.stages.map((s) => [s.id, s]));
  const byLabel = new Map(current.stages.map((s) => [s.label.trim().toLowerCase(), s]));

  for (const [order, step] of PLAN.entries()) {
    const body = { label: step.label, displayOrder: order, metadata: { probability: step.probability, isClosed: String(step.closed) } };
    const existing = byLabel.get(step.label.toLowerCase()) ?? (step.id ? byId.get(step.id) : undefined);
    const action = existing ? `rename "${existing.label}" → "${step.label}"` : `add "${step.label}"`;
    if (!apply) {
      console.log(`[dry run] ${order}. ${action}`);
      continue;
    }
    if (existing) await hs("PATCH", `/crm/v3/pipelines/deals/${pipeline}/stages/${existing.id}`, body);
    else await hs("POST", `/crm/v3/pipelines/deals/${pipeline}/stages`, body);
    console.log(`✓ ${order}. ${action}`);
  }

  if (apply) {
    const after = await hs<{ stages: Stage[] }>("GET", `/crm/v3/pipelines/deals/${pipeline}`);
    const labels = after.stages.sort((a, b) => a.displayOrder - b.displayOrder).map((s) => s.label);
    const missing = DEAL_STAGES.filter((d) => !labels.some((l) => l.trim().toLowerCase() === d.toLowerCase()));
    console.log(`\nPipeline now: ${labels.join(", ")}`);
    console.log(missing.length ? `✗ Still missing: ${missing.join(", ")}` : "✓ All stages the app needs are present.");
  } else {
    console.log("\nNothing changed. Re-run with --apply to make these changes.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
