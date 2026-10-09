/**
 * Dress rehearsal of a live call — WITHOUT Vaani. Plays Vaani's part exactly
 * as documented: BYOL WebSocket protocol against our real brain server, and
 * the call_started / call_ended / call_postprocessing webhooks against the
 * real app route. A Gemini "caller" talks to the agent. Then checks every
 * row the live call should produce in Neon.
 *
 *   npm run dev            (in another terminal)
 *   npm run rehearsal      (spawns the brain server itself)
 *
 * Costs no Vaani credit. Uses the Gemini free tier.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import WebSocket from "ws";
import { personaFor } from "../eval/personas";
import { generate, type GeminiContent } from "../lib/llm/gemini";
import { CALLER_SYSTEM } from "../lib/sim/simulate";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const APP = "http://localhost:3000";
const PORT = 8095;
const TOKEN = process.env.BRAIN_AUTH_TOKEN ?? "";
const checks: { ok: boolean; name: string; detail: string }[] = [];
const check = (ok: boolean, name: string, detail = "") => {
  checks.push({ ok, name, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function webhook(body: unknown) {
  const res = await fetch(`${APP}/api/voice/events?token=${process.env.VAANI_WEBHOOK_TOKEN}&sim=1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function connect(callId: string, auth: boolean): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${PORT}/chat/stream/${callId}`, { headers: auth ? { authorization: `Bearer ${TOKEN}` } : {} });
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

async function main() {
  if (!TOKEN) throw new Error("Set BRAIN_AUTH_TOKEN in .env.local");
  const appUp = await fetch(`${APP}/api/cron/sweep`).then((r) => r.status === 401).catch(() => false);
  if (!appUp) throw new Error("Start the app first: npm run dev");

  // Brain server, as Vaani would reach it (bearer auth on).
  const brain = spawn("npx", ["tsx", "server/brain-server.ts"], {
    env: { ...process.env, BRAIN_PORT: String(PORT), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let brainLog = "";
  brain.stdout.on("data", (d) => (brainLog += d));
  brain.stderr.on("data", (d) => (brainLog += d));
  for (let i = 0; i < 40 && !(await fetch(`http://localhost:${PORT}/health`).then((r) => r.ok).catch(() => false)); i++) await sleep(250);

  const callId = `room-rehearsal-${Date.now()}`;
  const phone = `+9198${String(Date.now()).slice(-8)}`;
  try {
    // 1. Auth on the BYOL socket.
    const rejected = await connect(`${callId}-x`, false).then((w) => (w.close(), false)).catch((e: Error) => /401/.test(e.message));
    check(rejected, "BYOL rejects a connection without the bearer token");

    // 2. Live-call conversation over the documented protocol.
    const ws = await connect(callId, true);
    const frames: Record<string, unknown>[] = [];
    let waiter: ((f: Record<string, unknown>) => void) | null = null;
    ws.on("message", (m) => {
      const f = JSON.parse(String(m));
      frames.push(f);
      if (f.response_type === "response" && waiter) waiter(f);
    });
    await sleep(300);
    check(frames[0]?.interaction_type === "config" && frames[1]?.interaction_type === "greeting", "handshake frames (config, greeting)");

    const greeting = "Hello, you've reached Aangan Studio. I'm Aangan's AI assistant, and this call is recorded. May I have your name, please?";
    const transcript: { role: string; content: string }[] = [{ role: "system", content: "(Vaani agent prompt)" }, { role: "assistant", content: greeting }];
    const spoken: { who: "AGENT" | "USER"; text: string; t: number }[] = [{ who: "AGENT", text: greeting, t: 0 }];
    const persona = personaFor("T01", 7);
    const callerHistory: GeminiContent[] = [{ role: "user", parts: [{ text: greeting }] }];
    const t0 = Date.now();
    let responseId = 0;
    let ended = false;
    let webhookSent = false;
    const turnMs: number[] = [];

    let callerHungUp = false;
    for (let turn = 0; turn < 16 && !ended; turn++) {
      const c = await generate({ system: CALLER_SYSTEM(persona), contents: callerHistory, temperature: 0.7, thinkingLevel: "minimal", maxOutputTokens: 300 });
      const said = c.text.replace("<HANGUP>", "").trim();
      callerHistory.push({ role: "model", parts: [{ text: c.text || "..." }] });
      if (!said || c.text.includes("<HANGUP>")) {
        callerHungUp = true;
        break;
      }
      transcript.push({ role: "user", content: said });
      spoken.push({ who: "USER", text: said, t: (Date.now() - t0) / 1000 });

      const reply = new Promise<Record<string, unknown>>((resolve) => (waiter = resolve));
      const sent = Date.now();
      ws.send(JSON.stringify({ interaction_type: "response_required", response_id: ++responseId, call_id: callId, transcript, req_body: null }));
      // Vaani's call_started webhook can arrive after the first turn — send it now to exercise that race.
      if (!webhookSent) {
        webhookSent = true;
        const r = await webhook({ event: "call_started", room_name: callId, status: "active", phone_number: phone });
        check(r.status === 200, "call_started webhook accepted (after first turn)", JSON.stringify(r.json));
      }
      const f = await reply;
      turnMs.push(Date.now() - sent);
      check(f.response_id === responseId && f.content_complete === true, `turn ${responseId}: response frame well-formed`, `${Date.now() - sent} ms`);
      const text = String(f.content ?? "");
      transcript.push({ role: "assistant", content: text });
      spoken.push({ who: "AGENT", text, t: (Date.now() - t0) / 1000 });
      callerHistory.push({ role: "user", parts: [{ text }] });
      ended = f.end_call === true;
    }
    ws.close();
    await sleep(1500); // brain saves the session on close
    const durationS = (Date.now() - t0) / 1000;
    check(ended || callerHungUp, "call ended cleanly", ended ? "agent sent end_call" : "caller said goodbye and hung up");

    // 3. Vaani's post-call webhooks.
    const hhmmss = (s: number) => new Date(s * 1000).toISOString().slice(11, 19);
    const vaaniTranscript = spoken.map((x) => `[${hhmmss(x.t)}] ${x.who}: ${x.text}`).join("\n\n");
    check((await webhook({ event: "call_ended", room_name: callId, call_duration: durationS, end_reason: "AGENT_REQUESTED_DISCONNECT" })).status === 200, "call_ended webhook accepted");
    const post = { event: "call_postprocessing", call_id: callId, timestamp: new Date().toISOString(), data: { room_name: callId, call_id: callId, call_duration: durationS, end_reason: "Call ended", summary: "Rehearsal call.", entities: {}, recording_url: null, transcript: vaaniTranscript } };
    check((await webhook(post)).json.queued === true, "call_postprocessing queued for the post-call pipeline");

    // 4. Check what landed in Neon.
    const { db } = await import("../lib/db/client");
    let row: Record<string, unknown> | undefined;
    // Wait for the whole pipeline: lead row, then the handoff that runs right after it.
    // (the booking SMS is sent right after the Telegram handoff, so wait for both)
    for (let i = 0; i < 60 && !(row?.lead_id && Number(row?.handoffs) > 0 && (Number(row?.bookings) === 0 || Number(row?.sms) > 0)); i++) {
      await sleep(1000);
      row = (
        await db().query(
          `select c.id, c.caller_phone, c.after_hours, c.duration_s, c.price_leak, c.processed_at, c.dropped, l.id lead_id, l.status, l.flags,
                  (select count(*)::int from bookings b where b.lead_id = l.id) bookings,
                  (select count(*)::int from call_costs cc where cc.call_id = c.id) cost_rows,
                  (select count(*)::int from call_costs cc where cc.call_id = c.id and cc.component = 'llm_dialogue' and cc.units > 0) dialogue_cost_rows,
                  (select count(*)::int from handoffs h where h.lead_id = l.id) handoffs,
                  (select count(*)::int from sms_messages s where s.lead_id = l.id and s.template = 'booking_confirmation') sms,
                  (select count(*)::int from call_sessions s where s.provider_call_id = c.provider_call_id) sessions,
                  extract(epoch from (select min(h.sent_at) from handoffs h where h.lead_id = l.id) - c.processed_at) handoff_s
             from calls c left join leads l on l.call_id = c.id where c.provider_call_id = $1`,
          [callId],
        )
      ).rows[0];
    }
    const r = row ?? {};
    check(r.caller_phone === phone, "caller number captured from call_started", String(r.caller_phone));
    check(Number(r.sessions) === 1, "brain session saved and found by the pipeline");
    check(r.status === "qualified", "lead qualified", `${r.status} · flags ${(r.flags as string[] | undefined)?.join(", ")}`);
    check(Number(r.bookings) === 1, "booking made in-call reached the bookings table");
    check(r.price_leak === false, "no price leak");
    check(r.dropped === false, "not flagged as dropped");
    check(Number(r.cost_rows) >= 4 && Number(r.dialogue_cost_rows) >= 1, "cost rows incl. dialogue LLM usage", `${r.cost_rows} rows`);
    check(Number(r.handoffs) >= 1, "handoff logged (HubSpot/Telegram or console)", `${r.handoffs}`);
    check(Number(r.sms) === 1, "booking confirmation SMS logged");
    check(r.handoff_s != null && Number(r.handoff_s) < 120, "handoff within 2 minutes of processing", `${Number(r.handoff_s).toFixed(1)} s`);

    // 5. Retried delivery must not create a second lead.
    const dup = await webhook(post);
    await sleep(3000);
    const leads = (await db().query("select count(*)::int n from leads l join calls c on c.id = l.call_id where c.provider_call_id = $1", [callId])).rows[0].n;
    check(dup.status === 200 && leads === 1, "duplicate call_postprocessing is ignored", `${leads} lead(s)`);

    const median = [...turnMs].sort((a, b) => a - b)[Math.floor(turnMs.length / 2)];
    console.log(`\nCall: ${spoken.length} turns · ${durationS.toFixed(0)} s wall clock · median agent turn ${median} ms`);
  } finally {
    brain.kill();
  }
  const failed = checks.filter((c) => !c.ok);
  if (failed.length) console.log(`\nbrain log tail:\n${brainLog.split("\n").slice(-15).join("\n")}`);
  console.log(failed.length ? `\n${failed.length} check(s) FAILED` : `\nAll ${checks.length} checks passed — the live path works end to end (minus Vaani itself).`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
