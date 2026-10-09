/**
 * Preflight before any live Vaani test. Read-only: never places a call and
 * never spends credit. Exits non-zero if anything blocks a live call.
 *
 *   npm run preflight
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

type Status = "ok" | "warn" | "block";
const results: { status: Status; check: string; detail: string }[] = [];
const add = (status: Status, check: string, detail: string) => results.push({ status, check, detail });
const env = (k: string) => (process.env[k] ?? "").trim();

/** JSON equality ignoring object key order (Postgres jsonb sorts keys). */
function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return sameJson(ka, kb) && ka.every((k) => sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

async function main() {
  // 1. Environment
  for (const k of ["DATABASE_URL", "DATABASE_URL_UNPOOLED", "GEMINI_API_KEYS", "VAANI_API_KEY", "VAANI_WEBHOOK_TOKEN", "CRON_SECRET", "NEON_AUTH_BASE_URL", "NEON_AUTH_COOKIE_SECRET"]) {
    add(env(k) ? "ok" : "block", `env ${k}`, env(k) ? "set" : "missing in .env.local");
  }
  add(env("VAANI_AGENT_ID") ? "ok" : "block", "env VAANI_AGENT_ID", env("VAANI_AGENT_ID") ? "set" : "missing — run `npm run vaani:setup` (dry run first)");
  add(env("BRAIN_AUTH_TOKEN") ? "ok" : "block", "env BRAIN_AUTH_TOKEN", env("BRAIN_AUTH_TOKEN") ? "set" : "missing — the BYOL server must not be open to the internet");
  const vp = env("VOICE_PROVIDER") || "simulated";
  add(vp === "simulated" ? "ok" : "warn", "VOICE_PROVIDER", vp === "simulated" ? "simulated — no credit can be spent (switch to 'vaani' only for the live test)" : `'${vp}' — real calls ARE possible`);

  // 2. Database
  try {
    const { db } = await import("../lib/db/client");
    const applied = new Set((await db().query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
    const files = readdirSync("db/migrations").filter((f) => f.endsWith(".sql"));
    const pending = files.filter((f) => !applied.has(f));
    add(pending.length ? "block" : "ok", "database migrations", pending.length ? `pending: ${pending.join(", ")} — run npm run db:migrate` : `${files.length} applied`);

    const seed = (await import("../db/seed/config.json")).default as Record<string, { value: unknown }>;
    const rows = (await db().query<{ key: string; value: unknown }>("select key, value from config")).rows;
    const drift = rows.filter((r) => seed[r.key] && !sameJson(r.value, seed[r.key].value)).map((r) => r.key);
    const capDrift = drift.includes("VOICE_SPEND_CAP");
    add(capDrift ? "block" : drift.length ? "warn" : "ok", "config matches seed", drift.length ? `differs: ${drift.join(", ")}${capDrift ? " — the live spend cap is NOT the seed value" : " (fine if edited on purpose)"}` : "all keys match");

    const { loadRuntimeConfig } = await import("../lib/config/runtime");
    const { voiceSpendSoFar } = await import("../lib/cost/spend-cap");
    const cfg = await loadRuntimeConfig();
    const spent = await voiceSpendSoFar();
    const left = cfg.voiceSpendCap.cap_inr - cfg.voiceSpendCap.reserve_inr - spent;
    add(left > 5 ? "ok" : "block", "voice spend cap", `₹${spent.toFixed(2)} of ₹${cfg.voiceSpendCap.cap_inr} used · ~${(Math.max(0, left) / 4.5).toFixed(1)} min left at ≈ ₹4.50/min (per second)`);
    add(cfg.voiceSpendCap.max_call_s <= 300 ? "ok" : "warn", "max call length", `${cfg.voiceSpendCap.max_call_s}s (brain hangs up after this)`);
  } catch (err) {
    add("block", "database", (err as Error).message.slice(0, 160));
  }

  // 3. Gemini (read-only model list)
  const keys = env("GEMINI_API_KEYS").split(",").map((k) => k.trim()).filter(Boolean);
  let working = 0;
  for (const key of keys) {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", { headers: { "x-goog-api-key": key } }).catch(() => null);
    if (res?.ok) working++;
  }
  add(working ? "ok" : "block", "Gemini keys", `${working}/${keys.length} working`);

  // 4. Vaani (read-only)
  try {
    const res = await fetch(`${env("VAANI_API_BASE") || "https://api.vaanivoice.ai/api"}/agents?page=1&page_size=50`, { headers: { "X-API-Key": env("VAANI_API_KEY") } });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const list = (json.agents ?? json.data ?? json.items ?? json.results ?? []) as Record<string, unknown>[];
    add(res.ok ? "ok" : "block", "Vaani API key", res.ok ? `valid · ${Array.isArray(list) ? list.length : "?"} agent(s)` : `HTTP ${res.status}`);
    if (env("VAANI_AGENT_ID") && Array.isArray(list)) {
      const found = list.some((a) => Object.values(a).includes(env("VAANI_AGENT_ID")));
      add(found ? "ok" : "warn", "Vaani agent exists", found ? "found" : "VAANI_AGENT_ID not in the agent list");
    }
  } catch (err) {
    add("block", "Vaani API", (err as Error).message);
  }

  // 5. Public reachability (Vaani must reach the brain + webhooks)
  const tunnel = ["cloudflared", "ngrok"].find((t) => {
    try {
      execSync(`command -v ${t}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  add(tunnel ? "ok" : "block", "tunnel tool", tunnel ?? "none installed — `brew install cloudflared` (free) to expose the brain + webhooks");
  const base = env("APP_BASE_URL");
  add(/^https:\/\//.test(base) && !/localhost/.test(base) ? "ok" : "block", "APP_BASE_URL is public https", base || "unset");
  add(/^wss:\/\//.test(env("BRAIN_WS_URL")) ? "ok" : "block", "BRAIN_WS_URL is public wss", env("BRAIN_WS_URL") || "unset — tunnel URL + /chat/stream");

  // 6. Local servers
  const brain = await fetch(`http://localhost:${env("BRAIN_PORT") || 8090}/health`).then((r) => r.ok).catch(() => false);
  add(brain ? "ok" : "warn", "brain server running", brain ? "healthy" : "not running — `npm run brain`");
  const app = await fetch("http://localhost:3000/api/cron/sweep").then((r) => r.status === 401).catch(() => false);
  add(app ? "ok" : "warn", "app server running", app ? "up (auth enforced)" : "not running — `npm run dev`");

  const icon = { ok: "✓", warn: "!", block: "✗" };
  for (const r of results) console.log(`${icon[r.status]} ${r.check.padEnd(30)} ${r.detail}`);
  const blocks = results.filter((r) => r.status === "block").length;
  console.log(blocks ? `\n${blocks} blocker(s) — not ready for a live call.` : "\nReady for a live call.");
  process.exit(blocks ? 1 : 0);
}

main();
