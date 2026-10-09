import type { LeadFacts, ToolName } from "../../agent/tools";
import type { BookingResult, Slot } from "../booking/types";
import type { CallerLookup } from "../crm/types";
import type { GeminiContent, GeminiUsage } from "../llm/gemini";
import type { DeclineReason } from "../schema/lead";
import type { LeadStatus } from "../qualify/routing";

export type CallPurpose = "inbound" | "drop_recovery" | "review_approval";

export interface TranscriptEntry {
  speaker: "agent" | "caller";
  text: string;
  at: string;
}

/** Serializable per-call state (persisted to call_sessions after every turn). */
export interface SessionState {
  callId: string;
  provider: string;
  direction: "inbound" | "outbound";
  purpose: CallPurpose;
  callerPhone: string | null;
  callerName: string | null;
  leadId: string | null;
  startedAt: string;
  promptVersion: string;
  afterHours: boolean;
  facts: LeadFacts;
  history: GeminiContent[];
  transcript: TranscriptEntry[];
  lookup: CallerLookup | null;
  scope: { status: "in_scope" | "out_of_scope" | "uncertain"; reasons: string[] } | null;
  evaluation: { outcome: LeadStatus; declineReason: DeclineReason | null; flags: string[]; reasons: string[] } | null;
  slotsOffered: Slot[];
  /** Caller turns heard when get_slots returned: book_slot needs a caller reply after the offer. */
  slotsOfferedAtCallerTurn?: number;
  booking: (BookingResult & { label: string; eventType: string }) | null;
  callbackWindow: string | null;
  complaint: { summary: string; wantsSenior: string | null } | null;
  /** Non-enquiry call: a message for a designer / the helpdesk. */
  message: { intent: string; forPerson: string | null; about: string; callbackWindow: string } | null;
  redirect: { mode: "transfer" | "callback_task"; nextOpening: string | null } | null;
  ended: boolean;
  endReason: string | null;
  usage: { calls: number; prompt: number; output: number; thoughts: number };
  toolLog: { name: ToolName; args: unknown; result: unknown; at: string; ms: number }[];
  /** Times the pre-speech guard replaced a draft reply containing a price. */
  guardRewrites: { draft: string; at: string }[];
  /** Latency of each agent turn in ms (LLM + tools). */
  turnLatencyMs: number[];
  /** Times evaluate_lead sent the agent back to ask missing intake fields. */
  intakeGates: number;
  /** Intake fields the server has prompted the agent to ask (in order). */
  intakePrompted: string[];
  /** end_call was refused once because a callback time hadn't been asked. */
  endRefused: boolean;
  /** First server-written typical-budget line given to the agent (set once shared). */
  budgetGuidance: string | null;
  /** Every server-written line that may carry a figure (first mention + repeats). Only these may be spoken. */
  approvedLines: string[];
}

export function newSession(init: {
  callId: string;
  provider: string;
  direction: "inbound" | "outbound";
  purpose: CallPurpose;
  callerPhone: string | null;
  callerName?: string | null;
  leadId?: string | null;
  startedAt: Date;
  promptVersion: string;
  afterHours: boolean;
  greeting: string;
  facts?: LeadFacts;
}): SessionState {
  return {
    callId: init.callId,
    provider: init.provider,
    direction: init.direction,
    purpose: init.purpose,
    callerPhone: init.callerPhone,
    callerName: init.callerName ?? null,
    leadId: init.leadId ?? null,
    startedAt: init.startedAt.toISOString(),
    promptVersion: init.promptVersion,
    afterHours: init.afterHours,
    facts: init.facts ?? {},
    history: [{ role: "model", parts: [{ text: init.greeting }] }],
    transcript: [{ speaker: "agent", text: init.greeting, at: init.startedAt.toISOString() }],
    lookup: null,
    scope: null,
    evaluation: null,
    slotsOffered: [],
    booking: null,
    callbackWindow: null,
    complaint: null,
    message: null,
    redirect: null,
    ended: false,
    endReason: null,
    usage: { calls: 0, prompt: 0, output: 0, thoughts: 0 },
    toolLog: [],
    guardRewrites: [],
    turnLatencyMs: [],
    intakeGates: 0,
    intakePrompted: [],
    endRefused: false,
    budgetGuidance: null,
    approvedLines: [],
  };
}

export function addUsage(state: SessionState, u: GeminiUsage) {
  state.usage.calls += 1;
  state.usage.prompt += u.promptTokenCount;
  state.usage.output += u.candidatesTokenCount;
  state.usage.thoughts += u.thoughtsTokenCount;
}

/** Deep-merge newly reported facts; later non-null values win, criteria merge per key. */
export function mergeFacts(current: LeadFacts, update: LeadFacts | undefined, clear: string[] = []): LeadFacts {
  const next: LeadFacts = { ...current };
  for (const k of clear) delete (next as Record<string, unknown>)[k];
  if (!update) return next;
  for (const [k, v] of Object.entries(update) as [keyof LeadFacts, unknown][]) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "criteria") next.criteria = { ...current.criteria, ...(v as LeadFacts["criteria"]) };
    else if (k === "watch_for") next.watch_for = [...new Set([...(current.watch_for ?? []), ...(v as string[])])];
    else if (k === "not_known") next.not_known = [...new Set([...(current.not_known ?? []), ...(v as string[])])];
    else (next as Record<string, unknown>)[k] = v;
  }
  return next;
}
