/**
 * The dialogue brain: one agent turn = Gemini with function calling, tools
 * executed server-side, then the pre-speech price guard. Transport-agnostic —
 * used by the Vaani BYOL WebSocket server and by the text simulator alike.
 */
import { activeGreeting, buildSystemPrompt, quickTest } from "../../agent/prompt";
import { toolDeclarations, type ToolName } from "../../agent/tools";
import { generate, type GeminiContent, type GeminiPart } from "../llm/gemini";
import { isOfficeHours, nowForPrompt } from "../time/ist";
import { guardUtterance } from "./guard";
import { addUsage, newSession, type CallPurpose, type SessionState } from "./state";
import { executeTool, type BrainDeps } from "./tools";

const MAX_TOOL_ROUNDS = 6;

export interface TurnResult {
  text: string;
  endCall: boolean;
  rewritten: boolean;
}

export function startSession(
  deps: BrainDeps,
  init: {
    callId: string;
    provider: string;
    direction: "inbound" | "outbound";
    purpose?: CallPurpose;
    callerPhone: string | null;
    callerName?: string | null;
    leadId?: string | null;
    greeting?: string;
  },
): SessionState {
  const now = deps.now();
  return newSession({
    ...init,
    purpose: init.purpose ?? "inbound",
    startedAt: now,
    promptVersion: deps.config.promptVersion,
    afterHours: !isOfficeHours(now, deps.config.officeHours),
    greeting: init.greeting ?? activeGreeting(),
  });
}

function systemPrompt(state: SessionState, deps: BrainDeps) {
  return buildSystemPrompt({
    nowIst: nowForPrompt(deps.now()),
    afterHours: state.afterHours,
    askBudget: deps.config.askBudget,
    priceDeflectionLine: deps.config.priceDeflectionLine,
    priceDeflectionNoBooking: deps.config.priceDeflectionNoBooking,
    declineLine: deps.config.declineLine,
    complaintCallbackMinutes: deps.config.complaintCallbackMinutes,
    quickTest: quickTest() && state.purpose === "inbound",
    outbound:
      state.purpose === "inbound"
        ? undefined
        : { purpose: state.purpose, name: state.callerName ?? undefined },
  });
}

/** Run one agent turn for the caller's latest utterance. Mutates state. */
export async function respond(state: SessionState, callerText: string, deps: BrainDeps): Promise<TurnResult> {
  const t0 = Date.now();
  const now = deps.now();
  state.transcript.push({ speaker: "caller", text: callerText, at: now.toISOString() });

  const elapsed = (now.getTime() - new Date(state.startedAt).getTime()) / 1000;
  const timeNote =
    elapsed > deps.config.callLimits.hard_max_s - 30
      ? "\n[system: the call is at its time limit — unless it's already booked, say in one sentence that a member of the team will get back to them as soon as possible to finish the details, then \"Have a good day!\", and call end_call now]"
      : elapsed > deps.config.callLimits.soft_wrap_s
        ? "\n[system: time is nearly up — wrap up now: book, take a callback window, or close]"
        : "";
  // First caller turn: the server looks the caller up itself (saves a model round).
  let lookupNote = "";
  if (!state.lookup && state.toolLog.length === 0) {
    const result = await executeTool("lookup_caller", {}, state, deps).catch(() => null);
    if (result) {
      state.toolLog.push({ name: "lookup_caller", args: {}, result, at: deps.now().toISOString(), ms: 0 });
      lookupNote = `\n[system: CRM lookup already done — ${JSON.stringify(result)}]`;
    }
  }
  state.history.push({ role: "user", parts: [{ text: callerText + timeNote + lookupNote }] });

  const tools = toolDeclarations();
  let text = "";
  let spokenWithTools = "";
  const toolLogStart = state.toolLog.length;
  let forceText = false;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await generate({
      model: process.env.GEMINI_DIALOGUE_MODEL ?? process.env.GEMINI_MODEL,
      system: systemPrompt(state, deps),
      contents: state.history,
      tools,
      toolMode: forceText ? "NONE" : "AUTO",
      temperature: 0.3,
      thinkingLevel: "minimal",
      maxOutputTokens: 1024,
    });
    addUsage(state, res.usage);

    if (!res.functionCalls.length) {
      text = res.text.trim();
      state.history.push({ role: "model", parts: res.parts.length ? res.parts : [{ text }] });
      break;
    }

    // Keep the model's parts verbatim (thought signatures), then answer every call.
    if (res.text.trim()) spokenWithTools = `${spokenWithTools} ${res.text.trim()}`.trim();
    state.history.push({ role: "model", parts: res.parts });
    const responses: GeminiPart[] = [];
    for (const call of res.functionCalls) {
      // The live test saw request_callback refused six times in one turn (9 s of silence).
      // After two refusals of the same tool this turn, stop and make the agent ask the caller.
      const refusals = state.toolLog.slice(toolLogStart).filter((t) => t.name === call.name && isRefusal(t.result)).length;
      if (refusals >= 2) {
        responses.push({ functionResponse: { name: call.name, response: { error: "Stop calling tools. Ask the caller the question you need, in one short sentence, and wait for their answer." }, ...(call.id ? { id: call.id } : {}) } });
        forceText = true;
        continue;
      }
      const started = Date.now();
      const result = await executeTool(call.name as ToolName, call.args, state, deps).catch((err: Error) => ({
        error: `Tool failed: ${err.message.slice(0, 200)}`,
      }));
      state.toolLog.push({ name: call.name as ToolName, args: call.args, result, at: deps.now().toISOString(), ms: Date.now() - started });
      responses.push({ functionResponse: { name: call.name, response: result, ...(call.id ? { id: call.id } : {}) } });
    }
    state.history.push({ role: "user", parts: responses });
  }

  text = [spokenWithTools, text].filter(Boolean).join(" ");
  if (!text) text = state.ended ? "Thank you for calling Aangan Studio. Goodbye!" : "Sorry, could you say that again?";

  const callerSoFar = state.transcript.filter((t) => t.speaker === "caller").map((t) => t.text);
  const guarded = guardUtterance(text, callerSoFar, deps.config.priceDeflectionLine, state.approvedLines ?? []);
  if (guarded.rewritten) {
    state.guardRewrites.push({ draft: text, at: deps.now().toISOString() });
    // Replace the leaked draft in history so the model never builds on it.
    const last = state.history[state.history.length - 1];
    if (last?.role === "model") last.parts = [{ text: guarded.text }];
  }
  if (state.ended) guarded.text = withSignOff(guarded.text);
  state.transcript.push({ speaker: "agent", text: guarded.text, at: deps.now().toISOString() });
  state.turnLatencyMs.push(Date.now() - t0);
  return { text: guarded.text, endCall: state.ended, rewritten: guarded.rewritten };
}

function isRefusal(result: unknown): boolean {
  const r = result as { error?: unknown; recorded?: unknown; booked?: unknown } | null;
  return !!r && (typeof r.error === "string" || r.recorded === false || r.booked === false);
}

/** Every call the agent ends closes with "Have a good day!" (unless it already said it). */
export function withSignOff(text: string): string {
  const t = text.trim();
  if (/have a (good|great|wonderful|lovely) day/i.test(t)) return t;
  return `${t}${/[.!?]$/.test(t) ? "" : "."} Have a good day!`;
}

/** History helper for transports that resend the whole transcript (Vaani BYOL). */
export function lastUserMessages(transcript: { role: string; content: string }[]): string {
  const out: string[] = [];
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role !== "user") break;
    out.unshift(transcript[i].content);
  }
  // Vaani sometimes repeats the same user line; de-duplicate consecutive repeats.
  return out.filter((t, i) => t !== out[i - 1]).join(" ");
}

export type { GeminiContent };
