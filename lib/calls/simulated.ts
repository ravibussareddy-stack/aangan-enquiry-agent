/** Push a text-simulated call through the real post-call pipeline (is_simulated = true). */
import type { SimResult } from "../sim/simulate";
import { processCompletedCall } from "./postcall";

export async function persistSimulatedCall(r: SimResult): Promise<string | null> {
  const s = r.state;
  const startedAt = new Date(s.startedAt);
  const res = await processCompletedCall({
    provider: "simulated",
    providerCallId: s.callId,
    direction: s.direction,
    callerPhone: s.callerPhone,
    startedAt,
    endedAt: new Date(startedAt.getTime() + r.durationS * 1000),
    durationS: r.durationS,
    transcript: s.transcript.map((t) => ({ speaker: t.speaker, text: t.text })),
    recordingUrl: null,
    summary: null,
    endReason: r.endedBy === "agent" ? "AGENT_REQUESTED_DISCONNECT" : r.dropped ? "USER_DISCONNECTED" : "Call ended",
    isSimulated: true,
    usage: { providerCallId: s.callId, billedMinutes: Math.max(1, Math.ceil(r.durationS / 60)), credits: null, raw: { simulated: true } },
    session: s,
  });
  return res.leadId;
}
