/**
 * VoiceProvider — everything provider-specific lives behind this interface so
 * Vaani can be swapped (brief §2). Dialogue itself is handled by our own brain
 * over Vaani's BYOL WebSocket, not by these methods.
 */
export interface NormalizedTurn {
  speaker: "agent" | "caller";
  text: string;
}

/** A provider webhook, normalised. */
export type VoiceEvent =
  | { kind: "call_started"; providerCallId: string; callerPhone: string | null; direction: "inbound" | "outbound"; at: Date }
  | { kind: "call_answered"; providerCallId: string; at: Date }
  | { kind: "call_failed"; providerCallId: string; status: "rejected" | "no_answer" | "failed"; at: Date; error?: string }
  | { kind: "call_ended"; providerCallId: string; durationS: number; endReason: string | null; at: Date }
  | {
      kind: "call_completed";
      providerCallId: string;
      durationS: number;
      endReason: string | null;
      summary: string | null;
      transcript: NormalizedTurn[];
      recordingUrl: string | null;
      entities: Record<string, unknown>;
      at: Date;
    }
  | { kind: "transfer"; providerCallId: string; status: "initiated" | "successful" | "failed"; phone: string | null; at: Date }
  | { kind: "ignored"; reason: string };

export interface OutboundCallRequest {
  to: string;
  name: string;
  purpose: "drop_recovery" | "review_approval";
  leadId: string | null;
  /** Template variables / context for the agent. */
  metadata: Record<string, string>;
}

export interface CallUsage {
  providerCallId: string;
  billedMinutes: number;
  /** Provider credits, if reported. */
  credits: number | null;
  raw: unknown;
}

export interface VoiceProvider {
  readonly name: "vaani" | "simulated";
  /** Verify + parse a webhook. Throws on bad signature/token. */
  handleInboundWebhook(req: { headers: Headers; rawBody: string; url: URL }): Promise<VoiceEvent>;
  /** Tools run in our own brain (BYOL); kept for providers with native tool calling. */
  toolCall?(name: string, args: unknown): Promise<unknown>;
  placeOutboundCall(req: OutboundCallRequest): Promise<{ providerCallId: string }>;
  /** Vaani has no SMS API — always delegated to SmsProvider. */
  sendSms?(to: string, body: string): Promise<void>;
  getCallUsage(providerCallId: string, durationS: number): Promise<CallUsage>;
}
