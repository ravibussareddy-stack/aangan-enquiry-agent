/**
 * Simulated voice provider: no telephony, no credit. Webhooks are accepted
 * in Vaani's format (so the same pipeline is exercised) with the token check;
 * outbound calls are recorded and run through the text simulator instead.
 */
import { randomUUID } from "node:crypto";
import type { CallUsage, OutboundCallRequest, VoiceEvent, VoiceProvider } from "./types";
import { normalizeVaaniEvent, verifyVaaniWebhook } from "./vaani";

export const simulatedOutbound: (OutboundCallRequest & { providerCallId: string; at: string })[] = [];

export class SimulatedVoiceProvider implements VoiceProvider {
  readonly name = "simulated" as const;

  async handleInboundWebhook(req: { headers: Headers; rawBody: string; url: URL }): Promise<VoiceEvent> {
    if (!verifyVaaniWebhook(req.headers, req.rawBody, req.url)) throw new Error("Invalid webhook token");
    return normalizeVaaniEvent(JSON.parse(req.rawBody));
  }

  async placeOutboundCall(req: OutboundCallRequest) {
    const providerCallId = `sim-outbound-${randomUUID().slice(0, 8)}`;
    simulatedOutbound.push({ ...req, providerCallId, at: new Date().toISOString() });
    return { providerCallId };
  }

  async getCallUsage(providerCallId: string, durationS: number): Promise<CallUsage> {
    return { providerCallId, billedMinutes: Math.max(1, Math.ceil(durationS / 60)), credits: null, raw: { simulated: true, durationS } };
  }
}
