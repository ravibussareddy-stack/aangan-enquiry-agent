/**
 * Create / configure the Vaani agent for this project.
 * DRY RUN by default — prints the payloads and calls nothing.
 * With --apply it creates the agent (no call is placed; whether agent creation
 * itself consumes credit isn't documented — check your balance afterwards).
 *
 *   npm run vaani:setup                         # dry run
 *   npm run vaani:setup -- --apply --byol wss://<your-tunnel>/chat/stream
 *
 * Afterwards: put the printed agent id in VAANI_AGENT_ID, attach your number
 * (Vaani dashboard → Deployment), and register the webhook
 * <APP_BASE_URL>/api/voice/events?token=<VAANI_WEBHOOK_TOKEN> under Settings → Webhooks.
 * If the BYOL URL doesn't stick via the API, set it in the dashboard:
 * Agent → Brain → LLM → "Bring your own LLM", Auth Token = BRAIN_AUTH_TOKEN.
 */
import { existsSync } from "node:fs";
import { activeGreeting, quickTest } from "../agent/prompt";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const BASE = process.env.VAANI_API_BASE ?? "https://api.vaanivoice.ai/api";
const apply = process.argv.includes("--apply");
const byolIdx = process.argv.indexOf("--byol");
const byolUrl = byolIdx > -1 ? process.argv[byolIdx + 1] : process.env.BRAIN_WS_URL;

const persona = {
  identity: {
    // The real prompt lives in our BYOL brain (agent/prompt.ts); this is only the fallback.
    system_prompt:
      "You are Aangan Studio's AI phone assistant. Say you are an AI assistant and the call is recorded. Never state any price. Take the caller's name and number and say a designer will call back.",
    greeting_message: { agent_message: activeGreeting(), agent_speech_delay: 0, interruptible: true },
  },
  senses_capabilities: {
    language: "en",
    brain: {
      llm: {
        extra_params: { ...(byolUrl ? { llm_websocket_url: byolUrl } : {}), fallback: "platform" },
      },
    },
  },
};
const experience = {
  settings: { call_settings: { max_call_duration: quickTest() ? 1 : 4, max_duration_enabled: true, end_call_message: "Thank you for calling Aangan Studio. Goodbye!" } },
};

async function call(method: string, path: string, body: unknown) {
  if (!apply) {
    console.log(`[dry run] ${method} ${BASE}${path}\n${JSON.stringify(body, null, 2)}\n`);
    return null;
  }
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "X-API-Key": process.env.VAANI_API_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  console.log(`${method} ${path} → ${res.status}`);
  if (!res.ok) throw new Error(JSON.stringify(json).slice(0, 500));
  return json as Record<string, unknown>;
}

async function main() {
  if (!byolUrl) console.warn("No BYOL URL (--byol wss://… or BRAIN_WS_URL) — the platform fallback LLM would answer calls.");
  let agentId = process.env.VAANI_AGENT_ID;
  if (!agentId) {
    const created = await call("POST", "/create-agent", { agent_display_name: "aangan-enquiries", config: { persona, experience } });
    agentId = (created?.agent_id ?? (created?.data as Record<string, unknown> | undefined)?.agent_id) as string | undefined;
    if (apply) console.log(`\nVAANI_AGENT_ID=${agentId ?? "(see response above)"}\n`);
  } else {
    await call("PATCH", `/agent/${agentId}/persona`, persona);
    await call("PATCH", `/agent/${agentId}/experience`, experience);
  }
  if (!apply) console.log("Dry run only. Re-run with --apply to send.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
