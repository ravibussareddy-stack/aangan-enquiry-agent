/**
 * Voice provider webhooks (Vaani format). Verified (signature or secret path
 * token), idempotent per (call, event), acknowledged immediately; the
 * post-call pipeline + handoff run in after() so the designer gets the note
 * well inside the 2-minute target.
 */
import { after, NextResponse } from "next/server";
import { processCompletedCall } from "@/lib/calls/postcall";
import { loadRuntimeConfig } from "@/lib/config/runtime";
import { db } from "@/lib/db/client";
import { isOfficeHours } from "@/lib/time/ist";
import { getVoiceProvider } from "@/lib/voice";
import { once } from "@/lib/webhooks/idempotency";

export const maxDuration = 120;

export async function POST(req: Request) {
  const rawBody = await req.text();
  const provider = getVoiceProvider();
  let event;
  try {
    event = await provider.handleInboundWebhook({ headers: req.headers, rawBody, url: new URL(req.url) });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (event.kind === "ignored") return NextResponse.json({ ok: true, ignored: event.reason });

  const providerName = provider.name === "vaani" ? "vaani" : "simulated";
  const eventId = `${event.providerCallId}:${event.kind}${event.kind === "transfer" ? `:${event.status}` : ""}`;

  if (event.kind === "call_completed") {
    after(() =>
      once(providerName, eventId, JSON.parse(rawBody), async () => {
        const call = await db().query<{ started_at: Date; caller_phone: string; direction: "inbound" | "outbound" }>(
          "select started_at, caller_phone, direction from calls where provider = $1 and provider_call_id = $2",
          [providerName, event.providerCallId],
        );
        const startedAt = call.rows[0]?.started_at ?? new Date(event.at.getTime() - event.durationS * 1000);
        const usage = await provider.getCallUsage(event.providerCallId, event.durationS);
        await processCompletedCall({
          provider: providerName,
          providerCallId: event.providerCallId,
          direction: call.rows[0]?.direction ?? (event.providerCallId.startsWith("outbound") ? "outbound" : "inbound"),
          callerPhone: call.rows[0]?.caller_phone ?? null,
          startedAt,
          endedAt: new Date(startedAt.getTime() + event.durationS * 1000),
          durationS: event.durationS,
          transcript: event.transcript,
          recordingUrl: event.recordingUrl,
          summary: event.summary,
          endReason: event.endReason,
          isSimulated: providerName === "simulated",
          usage,
        });
      }).then(() => undefined),
    );
    return NextResponse.json({ ok: true, queued: true });
  }

  const result = await once(providerName, eventId, JSON.parse(rawBody), async () => {
    if (event.kind === "call_started") {
      const cfg = await loadRuntimeConfig();
      await db().query(
        `insert into calls (provider, provider_call_id, direction, caller_phone, started_at, after_hours, is_simulated)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (provider, provider_call_id) do nothing`,
        [providerName, event.providerCallId, event.direction, event.callerPhone ?? "unknown", event.at, !isOfficeHours(event.at, cfg.officeHours), providerName === "simulated"],
      );
    } else if (event.kind === "call_answered") {
      await db().query("update calls set answered_at = $3 where provider = $1 and provider_call_id = $2", [providerName, event.providerCallId, event.at]);
    } else if (event.kind === "call_ended") {
      await db().query(
        "update calls set ended_at = $3, duration_s = $4 where provider = $1 and provider_call_id = $2",
        [providerName, event.providerCallId, event.at, Math.round(event.durationS)],
      );
    } else if (event.kind === "call_failed") {
      await db().query(
        "update outbound_attempts set result = $2 where provider_call_id = $1",
        [event.providerCallId, event.status],
      );
    }
  });
  return NextResponse.json({ ok: true, result });
}
