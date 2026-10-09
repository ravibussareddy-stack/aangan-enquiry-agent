/**
 * Vaani BYOL call handler — shared by the cloud brain (Neon Function,
 * functions/brain) and the local dev server (server/brain-server.ts).
 *
 * Protocol (docs.vaanivoice.ai/guides/byol): Vaani opens <url>/<call_id> per call,
 * sends {"interaction_type":"response_required", response_id, call_id, transcript[], req_body};
 * we reply with {"response_type":"response", response_id, content, content_complete, end_call?}.
 * On connect we send a "config" and a "greeting" frame.
 */
import { timingSafeEqual } from "node:crypto";
import { withQuickTestLimits } from "../../agent/prompt";
import { getCalendar } from "../booking";
import { saveSession } from "../calls/postcall";
import { loadRuntimeConfig } from "../config/runtime";
import { getCrm } from "../crm";
import { db } from "../db/client";
import { alertOps, notifyStaff } from "../staff/notify";
import { lastUserMessages, respond, startSession } from "./session";
import type { SessionState } from "./state";
import type { BrainDeps } from "./tools";

/** The bits of a WebSocket we use — satisfied by both the standard WebSocket and `ws`. */
export interface CallSocket {
  readonly readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
}

/** In-process call state, per isolate. One call = one WebSocket = one isolate; Postgres keeps the record. */
const sessions = new Map<string, SessionState>();

/** Vaani sends `Authorization: Bearer <BRAIN_AUTH_TOKEN>`. Without a token the brain is open only in local dev. */
export function brainAuthorized(header: string | null | undefined): boolean {
  const token = process.env.BRAIN_AUTH_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production" && !process.env.NEON_BRANCH;
  const a = Buffer.from(`Bearer ${token}`);
  const b = Buffer.from(header ?? "");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Call id from the WebSocket path: /chat/stream/<call_id>. */
export function callIdFromPath(pathname: string): string {
  return decodeURIComponent(pathname.split("/").filter(Boolean).pop() ?? "");
}

async function deps(): Promise<BrainDeps> {
  const config = withQuickTestLimits(await loadRuntimeConfig());
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

function send(ws: CallSocket, frame: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(frame));
}

function text(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data);
  return String(data);
}

type Inbound = {
  interaction_type?: string;
  response_id?: number;
  call_id?: string;
  transcript?: { role: string; content: string }[];
  req_body?: Record<string, unknown> | null;
  response_type?: string;
};

/** Run one Vaani call over an already-open (or opening) WebSocket. */
export function handleByolCall(ws: CallSocket, pathCallId: string): void {
  // Sent once the socket is open (standard sockets start CONNECTING).
  const hello = () => {
    send(ws, { interaction_type: "config", content: "Server ready" });
    send(ws, { interaction_type: "greeting", content: "Hello" });
  };
  if (ws.readyState === ws.OPEN) hello();
  else (ws as unknown as { addEventListener(t: "open", l: () => void): void }).addEventListener("open", hello);

  let queue = Promise.resolve();
  // Vaani sends response_required again while the caller is still mid-sentence
  // ("Yes. I want my" → "Yes. I want my flat…"). Only the newest request is
  // answered: older ones still queued are skipped, and one that finishes after
  // a newer request arrived is rolled back and never spoken.
  let latestId = -1;

  ws.addEventListener("message", (event) => {
    let msg: Inbound;
    try {
      msg = JSON.parse(text(event.data));
    } catch {
      return;
    }
    if (msg.response_type === "ping_pong") return;
    if (msg.interaction_type !== "response_required") return;
    const id = msg.response_id ?? 0;
    latestId = Math.max(latestId, id);
    queue = queue.then(async () => {
      if (id < latestId) return; // superseded before we started
      const callId = msg.call_id ?? pathCallId;
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
          const { assertVoiceSpendAllowed } = await import("../cost/spend-cap");
          const allowed = await assertVoiceSpendAllowed().then(() => true).catch(() => false);
          if (!allowed) {
            send(ws, { response_type: "response", response_id: id, content: "Sorry, we can't take your call right now. Please call Aangan Studio again during office hours. Goodbye!", content_complete: true, end_call: true });
            await alertOps(`Voice spend cap reached — call ${callId} was ended immediately.`);
            return;
          }
        }
        const elapsed = (Date.now() - new Date(state.startedAt).getTime()) / 1000;
        if (elapsed > d.config.voiceSpendCap.max_call_s) {
          send(ws, { response_type: "response", response_id: id, content: "Thank you for calling Aangan Studio — a member of our team will get back to you as soon as possible to finish the details. Have a good day!", content_complete: true, end_call: true });
          return;
        }
        const userText = lastUserMessages(msg.transcript ?? []);
        // Vaani's BYOL connection check — not the caller. Answer it, record nothing.
        if (/^reply with ok\.?$/i.test(userText.trim())) {
          send(ws, { response_type: "response", response_id: id, content: "OK", content_complete: true });
          return;
        }
        const snapshot = structuredClone(state);
        const t0 = Date.now();
        const turn = await respond(state, userText || "(silence)", d);
        if (id < latestId) {
          sessions.set(callId, snapshot); // the caller kept talking: drop this reply
          if (process.env.BRAIN_DEBUG) console.log(`[brain] ${callId}#${id} superseded by #${latestId} — discarded`);
          return;
        }
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

  ws.addEventListener("close", () => {
    const s = sessions.get(pathCallId);
    if (s) void saveSession(s).finally(() => sessions.delete(pathCallId));
  });
}
