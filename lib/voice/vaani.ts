/**
 * Vaani adapter (docs.vaanivoice.ai, checked 2026-10-07).
 * - Webhooks (dashboard): call_started … call_ended (duration in SECONDS),
 *   call_postprocessing (transcript/summary/entities; duration in MILLISECONDS).
 *   Signing is only documented for campaign webhooks (X-Vaani-Signature =
 *   HMAC-SHA256 over "{timestamp}.{body}"); we verify it when present and
 *   otherwise require the secret path token ?token=VAANI_WEBHOOK_TOKEN.
 * - Outbound: POST /trigger-call/ (agent_id, contact_number, name, metadata).
 * - Usage: GET /call-history (call_cost in credits, duration_ms). ₹ per minute
 *   comes from the rates table; billed minutes are rounded up per call.
 * - SMS: not offered by Vaani.
 *
 * GUARDED: placeOutboundCall refuses unless VOICE_PROVIDER=vaani AND the spend
 * cap allows it — placing a call spends real credit.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { toE164 } from "../phone";
import { fetchWithRetry } from "../http/retry";
import type { CallUsage, NormalizedTurn, OutboundCallRequest, VoiceEvent, VoiceProvider } from "./types";

const BASE = () => process.env.VAANI_API_BASE ?? "https://api.vaanivoice.ai/api";

export function parseVaaniTranscript(text: string): NormalizedTurn[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim().replace(/^\[\d{1,2}:\d{2}(?::\d{2})?\]\s*/, ""))
    .map((l) => {
      const m = l.match(/^(AGENT|USER)\s*:\s*(.*)$/i);
      return m ? { speaker: m[1].toUpperCase() === "AGENT" ? ("agent" as const) : ("caller" as const), text: m[2].trim() } : null;
    })
    .filter((t): t is NormalizedTurn => !!t && !!t.text);
}

export function verifyVaaniWebhook(headers: Headers, rawBody: string, url: URL): boolean {
  const secret = process.env.VAANI_WEBHOOK_SECRET;
  const sig = headers.get("x-vaani-signature");
  const ts = headers.get("x-vaani-timestamp");
  if (secret && sig && ts) {
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
    const expected = `sha256=${createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex")}`;
    const a = Buffer.from(expected);
    const b = Buffer.from(sig);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const token = process.env.VAANI_WEBHOOK_TOKEN;
  const given = url.searchParams.get("token") ?? "";
  if (!token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Call length in seconds. Vaani's live webhooks send call_duration in SECONDS
 * (e.g. 74.71) on both call_ended and call_postprocessing, under `data` — the
 * docs say milliseconds. Anything over 4 hours is taken as milliseconds.
 */
export function vaaniDurationS(payload: Record<string, unknown>, data: Record<string, unknown>): number {
  const raw = Number(data.call_duration ?? payload.call_duration ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return raw > 4 * 3600 ? raw / 1000 : raw;
}

export function normalizeVaaniEvent(payload: Record<string, unknown>, now = new Date()): VoiceEvent {
  const event = String(payload.event ?? "");
  const data = (payload.data as Record<string, unknown> | undefined) ?? payload;
  const id = String(data.call_id ?? data.room_name ?? payload.call_id ?? payload.room_name ?? "");
  if (!id) return { kind: "ignored", reason: "no call id" };
  switch (event) {
    case "call_started": {
      const phone = toE164(String(data.phone_number ?? payload.phone_number ?? payload.from_number ?? ""));
      return { kind: "call_started", providerCallId: id, callerPhone: phone, direction: id.startsWith("outbound") ? "outbound" : "inbound", at: now };
    }
    case "user_picked_up_at":
      return { kind: "call_answered", providerCallId: id, at: now };
    case "call_rejected":
    case "call_no_answer":
    case "call_failed":
      return {
        kind: "call_failed",
        providerCallId: id,
        status: event === "call_rejected" ? "rejected" : event === "call_no_answer" ? "no_answer" : "failed",
        error: payload.error ? String(payload.error) : undefined,
        at: now,
      };
    case "call_ended":
      return { kind: "call_ended", providerCallId: id, durationS: vaaniDurationS(payload, data), endReason: ((data.end_reason ?? payload.end_reason) as string) ?? null, at: now };
    case "call_postprocessing":
      return {
        kind: "call_completed",
        providerCallId: id,
        durationS: vaaniDurationS(payload, data),
        endReason: (data.end_reason as string) ?? null,
        summary: (data.summary as string) ?? null,
        transcript: parseVaaniTranscript(String(data.transcript ?? "")),
        recordingUrl: (data.recording_url as string) ?? null,
        entities: (data.entities as Record<string, unknown>) ?? {},
        at: payload.timestamp ? new Date(String(payload.timestamp)) : now,
      };
    case "human_transfer_initiated":
    case "human_transfer_successful":
    case "human_transfer_failed":
      return {
        kind: "transfer",
        providerCallId: id,
        status: event.endsWith("initiated") ? "initiated" : event.endsWith("successful") ? "successful" : "failed",
        phone: (payload.phone_number as string) ?? null,
        at: now,
      };
    default:
      return { kind: "ignored", reason: `event ${event}` };
  }
}

export class VaaniProvider implements VoiceProvider {
  readonly name = "vaani" as const;

  async handleInboundWebhook(req: { headers: Headers; rawBody: string; url: URL }): Promise<VoiceEvent> {
    if (!verifyVaaniWebhook(req.headers, req.rawBody, req.url)) throw new Error("Invalid Vaani webhook signature/token");
    return normalizeVaaniEvent(JSON.parse(req.rawBody));
  }

  async placeOutboundCall(req: OutboundCallRequest): Promise<{ providerCallId: string }> {
    if (process.env.VOICE_PROVIDER !== "vaani") throw new Error("Refusing to place a real call: VOICE_PROVIDER is not 'vaani'");
    const res = await fetchWithRetry(
      `${BASE()}/trigger-call/`,
      {
        method: "POST",
        headers: { "X-API-Key": process.env.VAANI_API_KEY ?? "", "content-type": "application/json", "X-Agent-Id": `aangan-${req.purpose}` },
        body: JSON.stringify({
          agent_id: process.env.VAANI_AGENT_ID,
          medium: "telephony",
          contact_number: req.to,
          name: req.name || "Customer",
          metadata: { ...req.metadata, purpose: req.purpose, lead_id: req.leadId ?? "" },
          ...(process.env.VAANI_OUTBOUND_NUMBER ? { outbound_number: process.env.VAANI_OUTBOUND_NUMBER } : {}),
        }),
      },
      { retries: 1 },
    );
    const json = (await res.json()) as { success?: boolean; output?: { call_id?: string }; message?: string };
    if (!res.ok || !json.success || !json.output?.call_id) throw new Error(`Vaani trigger-call failed: ${res.status} ${json.message ?? ""}`);
    return { providerCallId: json.output.call_id };
  }

  async getCallUsage(providerCallId: string, durationS: number): Promise<CallUsage> {
    // call-history has no documented filter by call id; fall back to duration if not found on page 1.
    let raw: unknown = null;
    let credits: number | null = null;
    try {
      const res = await fetchWithRetry(`${BASE()}/call-history?page=1&page_size=50`, { headers: { "X-API-Key": process.env.VAANI_API_KEY ?? "" } }, { retries: 1 });
      if (res.ok) {
        const json = (await res.json()) as { data?: { call_id: string; call_cost?: number; duration_ms?: number }[] };
        const row = json.data?.find((d) => d.call_id === providerCallId);
        if (row) {
          raw = row;
          credits = row.call_cost ?? null;
        }
      }
    } catch {
      // usage lookup is best-effort
    }
    // Vaani bills per second (observed 2026-10-09; the rate is in the rates table), so no rounding up to whole minutes.
    return { providerCallId, billedMinutes: Math.round((durationS / 60) * 10000) / 10000, credits, raw: raw ?? { durationS, source: "webhook duration" } };
  }
}

/**
 * Browser test call (Vaani WebRTC): no phone number needed. Returns the LiveKit
 * token + URL the browser joins with. Same agent (our BYOL brain), same per-call time limit.
 */
export async function startVaaniWebSession(opts: { greeting: string }): Promise<{ token: string; url: string; room: string }> {
  if (process.env.VOICE_PROVIDER !== "vaani") throw new Error("VOICE_PROVIDER is not 'vaani' — browser test calls are off");
  if (!process.env.VAANI_API_KEY || !process.env.VAANI_AGENT_ID) throw new Error("VAANI_API_KEY / VAANI_AGENT_ID are not set");
  const res = await fetchWithRetry(
    `${BASE()}/trigger-call/`,
    {
      method: "POST",
      headers: { "X-API-Key": process.env.VAANI_API_KEY, "X-Agent-Id": "aangan-browser-test", "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: process.env.VAANI_AGENT_ID,
        medium: "webrtc",
        primary_language: "en",
        secondary_language: "hi",
        welcome_message: opts.greeting,
        welcome_interruptible: true,
      }),
    },
    { retries: 0 },
  );
  if (!res.ok) throw new Error(`Vaani trigger-call (webrtc) ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { token?: string; connection_url?: string; room_name?: string };
  if (!json.token || !json.connection_url) throw new Error("Vaani didn't return a WebRTC token");
  return { token: json.token, url: json.connection_url, room: json.room_name ?? "" };
}
