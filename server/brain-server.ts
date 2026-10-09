/**
 * Vaani BYOL WebSocket server — the dialogue brain for live calls.
 * Protocol (docs.vaanivoice.ai/guides/byol): Vaani opens <url>/<call_id> per call,
 * sends {"interaction_type":"response_required", response_id, call_id, transcript[], req_body};
 * we reply with {"response_type":"response", response_id, content, content_complete, end_call?}.
 * On connect we must send a "config" and a "greeting" frame.
 *
 *   npm run brain            # listens on BRAIN_PORT (default 8090)
 *   (expose with a free Cloudflare tunnel; paste wss://…/chat/stream into Vaani → Brain → BYOL)
 *
 * Costs no Vaani credit by itself — credit is only spent when Vaani places/answers a call.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { WebSocketServer, type WebSocket } from "ws";
import { getCalendar } from "../lib/booking";
import { lastUserMessages, respond, startSession } from "../lib/brain/session";
import type { SessionState } from "../lib/brain/state";
import type { BrainDeps } from "../lib/brain/tools";
import { saveSession } from "../lib/calls/postcall";
import { loadRuntimeConfig } from "../lib/config/runtime";
import { getCrm } from "../lib/crm";
import { db } from "../lib/db/client";
import { alertOps, notifyStaff } from "../lib/staff/notify";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = Number(process.env.BRAIN_PORT ?? 8090);
const sessions = new Map<string, SessionState>();

function authorized(header: string | undefined): boolean {
  const token = process.env.BRAIN_AUTH_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production"; // open only in local dev
  const a = Buffer.from(`Bearer ${token}`);
  const b = Buffer.from(header ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function deps(): Promise<BrainDeps> {
  const config = await loadRuntimeConfig();
  return {
    calendar: getCalendar(),
    crm: getCrm(),
    config,
    now: () => new Date(),
    onComplaint: async (s) => {
      await notifyStaff({
        group: "senior",
        subject: `URGENT complaint (live call) · ${s.callerPhone ?? "unknown caller"}`,
        telegramChat: process.env.TELEGRAM_SENIOR_CHAT_ID,
        text: `URGENT · COMPLAINT (live call)\n${s.complaint?.summary ?? ""}\nCaller: ${s.callerPhone ?? "unknown"}${s.complaint?.wantsSenior ? `\nWants: ${s.complaint.wantsSenior}` : ""}\nFree times: ${s.callbackWindow ?? "not given"}\nTold: as soon as possible (target ${config.complaintCallbackMinutes} min)`,
      });
    },
    previousFacts: async (phone) => {
      const { rows } = await db().query<{ state: SessionState }>(
        `select s.state from call_sessions s join calls c on c.provider_call_id = s.provider_call_id
          where c.caller_phone = $1 and c.dropped and c.started_at > now() - interval '1 day'
          order by c.started_at desc limit 1`,
        [phone],
      );
      return rows[0]?.state.facts ?? null;
    },
  };
}

async function sessionFor(callId: string, reqBody: Record<string, unknown> | null, d: BrainDeps): Promise<SessionState> {
  const cached = sessions.get(callId);
  if (cached) return cached;
  const meta = ((reqBody?.metadata as Record<string, string>) ?? {}) as Record<string, string>;
  const phoneRow = await db()
    .query<{ caller_phone: string }>("select caller_phone from calls where provider_call_id = $1", [callId])
    .catch(() => ({ rows: [] as { caller_phone: string }[] }));
  const purpose = meta.purpose === "drop_recovery" || meta.purpose === "review_approval" ? meta.purpose : "inbound";
  const s = startSession(d, {
    callId,
    provider: "vaani",
    direction: purpose === "inbound" ? "inbound" : "outbound",
    purpose,
    callerPhone: (reqBody?.contact_number as string) ?? phoneRow.rows[0]?.caller_phone ?? null,
    callerName: (reqBody?.name as string) ?? null,
    leadId: meta.lead_id || null,
  });
  sessions.set(callId, s);
  return s;
}

function send(ws: WebSocket, frame: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

const http = createServer((req, res) => {
  res.writeHead(req.url === "/health" ? 200 : 404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: req.url === "/health" }));
});
const wss = new WebSocketServer({ noServer: true });

http.on("upgrade", (req, socket, head) => {
  if (!authorized(req.headers.authorization)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }
  const callId = decodeURIComponent((req.url ?? "").split("?")[0].split("/").filter(Boolean).pop() ?? "");
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, callId));
});

wss.on("connection", (ws: WebSocket, callIdFromPath: string) => {
  send(ws, { interaction_type: "config", content: "Server ready" });
  send(ws, { interaction_type: "greeting", content: "Hello" });
  let queue = Promise.resolve();

  ws.on("message", (raw) => {
    queue = queue.then(async () => {
      let msg: { interaction_type?: string; response_id?: number; call_id?: string; transcript?: { role: string; content: string }[]; req_body?: Record<string, unknown> | null; response_type?: string };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.response_type === "ping_pong") return;
      if (msg.interaction_type !== "response_required") return;
      const callId = msg.call_id ?? callIdFromPath;
      const id = msg.response_id ?? 0;
      try {
        const d = await deps();
        const state = await sessionFor(callId, msg.req_body ?? null, d);
        // Inbound calls: Vaani sends no caller number over BYOL (req_body is null); it arrives
        // with the call_started webhook, which may land after the first turn — keep checking.
        if (!state.callerPhone) {
          const row = await db()
            .query<{ caller_phone: string }>("select caller_phone from calls where provider_call_id = $1 and caller_phone <> 'unknown'", [callId])
            .catch(() => ({ rows: [] as { caller_phone: string }[] }));
          state.callerPhone = row.rows[0]?.caller_phone ?? null;
        }
        // Spend cap: Vaani answers inbound calls regardless, so refuse politely on the first turn.
        if (state.transcript.length <= 1 && process.env.VOICE_PROVIDER === "vaani") {
          const { assertVoiceSpendAllowed } = await import("../lib/cost/spend-cap");
          const allowed = await assertVoiceSpendAllowed().then(() => true).catch(() => false);
          if (!allowed) {
            send(ws, { response_type: "response", response_id: id, content: "Sorry, we can't take your call right now. Please call Aangan Studio again during office hours. Goodbye!", content_complete: true, end_call: true });
            await alertOps(`Voice spend cap reached — call ${callId} was ended immediately.`);
            return;
          }
        }
        const elapsed = (Date.now() - new Date(state.startedAt).getTime()) / 1000;
        if (elapsed > d.config.voiceSpendCap.max_call_s) {
          send(ws, { response_type: "response", response_id: id, content: "Thank you for calling Aangan Studio. A designer will follow up with you. Goodbye!", content_complete: true, end_call: true });
          return;
        }
        const userText = lastUserMessages(msg.transcript ?? []);
        const t0 = Date.now();
        const turn = await respond(state, userText || "(silence)", d);
        if (process.env.BRAIN_DEBUG) console.log(`[brain] ${callId}#${id} ${Date.now() - t0}ms tools=${state.toolLog.slice(-3).map((t) => t.name).join(",")}`);
        send(ws, { response_type: "response", response_id: id, content: turn.text, content_complete: true, ...(turn.endCall ? { end_call: true } : {}) });
        await saveSession(state).catch((err) => console.error("[brain] saveSession", err));
      } catch (err) {
        console.error("[brain] turn failed", err);
        send(ws, { response_type: "response", response_id: id, content: "Sorry, I didn't catch that — could you say it again?", content_complete: true });
        await alertOps(`Brain turn failed on ${callId}: ${(err as Error).message}`);
      }
    });
  });

  ws.on("close", () => {
    const s = sessions.get(callIdFromPath);
    if (s) void saveSession(s).finally(() => sessions.delete(callIdFromPath));
  });
});

http.listen(PORT, () => console.log(`[brain] BYOL WebSocket server on :${PORT} (path /chat/stream/<call_id>)`));
