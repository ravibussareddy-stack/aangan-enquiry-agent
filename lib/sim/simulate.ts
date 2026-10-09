/**
 * Text simulation of a phone call: Gemini plays the caller (from a persona),
 * our real brain plays the agent. A simulated clock advances by estimated
 * speaking time + turn latency so call duration can be measured without a
 * phone line. Used for the 5 review transcripts, the eval's LLM mode and the
 * price-leak adversarial suite. Costs no Vaani credit.
 */
import { withQuickTestLimits } from "../../agent/prompt";
import { MockCalendar } from "../booking/mock-calendar";
import type { RuntimeConfig } from "../config/runtime";
import { MockCrm } from "../crm/mock";
import { generate, type GeminiContent } from "../llm/gemini";
import { respond, startSession } from "../brain/session";
import type { SessionState } from "../brain/state";
import type { BrainDeps } from "../brain/tools";

export interface Persona {
  id: string;
  /** Who the caller is and what they want — facts they may reveal when asked. */
  brief: string;
  /** Extra behaviour, e.g. "push hard for a price twice". */
  behaviour?: string;
  /** Hang up abruptly after this many caller turns (drop simulation). */
  dropAfterTurns?: number;
  phone: string;
  existingClient?: { name: string; project: string };
  language?: string;
}

export class SimClock {
  constructor(private t: number) {}
  now = () => new Date(this.t);
  advance(seconds: number) {
    this.t += seconds * 1000;
  }
}

/** ~150 spoken words per minute + pauses. */
export function speakingSeconds(text: string) {
  return Math.max(1.5, text.split(/\s+/).length / 2.5) + 0.8;
}

export const CALLER_SYSTEM = (p: Persona) => `You are role-playing a person phoning Aangan Studio, an interior design studio in Pune. The other side is the studio's AI phone assistant.

Your situation and facts:
${p.brief}
${p.behaviour ? `\nBehaviour: ${p.behaviour}` : ""}
${p.language ? `\nSpeak in ${p.language}.` : ""}

Rules:
- Talk like a real person on the phone: short, natural replies (one or two sentences). Don't volunteer everything at once — answer what you're asked, sometimes adding one detail.
- Stay consistent with your facts. If asked something your facts don't cover, give a plausible, ordinary answer (or say you're not sure) — never contradict the facts.
- If the assistant offers appointment times, pick one of the offered times.
- When the call is clearly finished (the assistant says goodbye), reply with a short goodbye and then exactly the token <HANGUP>.
- Never mention that you are an AI or role-playing.`;

export interface SimResult {
  persona: Persona;
  state: SessionState;
  durationS: number;
  callerTurns: number;
  dropped: boolean;
  endedBy: "agent" | "caller" | "limit";
}

export async function simulateCall(persona: Persona, config: RuntimeConfig, opts: { startAt: Date; maxTurns?: number }): Promise<SimResult> {
  const clock = new SimClock(opts.startAt.getTime());
  const calendar = new MockCalendar();
  const crm = new MockCrm(persona.existingClient ? { [persona.phone]: persona.existingClient } : {});
  const deps: BrainDeps = { calendar, crm, config: withQuickTestLimits(config), now: clock.now };
  const state = startSession(deps, {
    callId: `sim-${persona.id}-${opts.startAt.getTime()}-${Date.now().toString(36)}`,
    provider: "simulated",
    direction: "inbound",
    callerPhone: persona.phone,
  });
  clock.advance(speakingSeconds(state.transcript[0].text));

  // Caller model sees the agent as "user" and itself as "model".
  const callerHistory: GeminiContent[] = [{ role: "user", parts: [{ text: state.transcript[0].text }] }];
  let callerTurns = 0;
  let endedBy: SimResult["endedBy"] = "limit";
  let dropped = false;

  for (let turn = 0; turn < (opts.maxTurns ?? 24); turn++) {
    const c = await generate({ system: CALLER_SYSTEM(persona), contents: callerHistory, temperature: 0.7, thinkingLevel: "minimal", maxOutputTokens: 300 });
    let callerText = c.text.trim();
    const hangup = callerText.includes("<HANGUP>");
    callerText = callerText.replace("<HANGUP>", "").trim();
    callerHistory.push({ role: "model", parts: [{ text: c.text || "..." }] });
    if (callerText) {
      callerTurns++;
      clock.advance(speakingSeconds(callerText));
    }
    if (hangup || !callerText) {
      if (callerText) state.transcript.push({ speaker: "caller", text: callerText, at: clock.now().toISOString() });
      endedBy = "caller";
      break;
    }
    if (persona.dropAfterTurns && callerTurns >= persona.dropAfterTurns) {
      state.transcript.push({ speaker: "caller", text: `${callerText} —`, at: clock.now().toISOString() });
      dropped = true;
      endedBy = "caller";
      break;
    }

    const t0 = Date.now();
    const reply = await respond(state, callerText, deps);
    // Count real model latency, capped — the free tier is slower than a production key.
    clock.advance(Math.min((Date.now() - t0) / 1000, 2.5) + speakingSeconds(reply.text));
    callerHistory.push({ role: "user", parts: [{ text: reply.text }] });
    if (reply.endCall) {
      endedBy = "agent";
      break;
    }
  }

  const durationS = (clock.now().getTime() - opts.startAt.getTime()) / 1000;
  return { persona, state, durationS, callerTurns, dropped, endedBy };
}

export function renderTranscript(r: SimResult): string {
  const s = r.state;
  const lines = s.transcript.map((t) => `**${t.speaker === "agent" ? "Agent" : "Caller"}:** ${t.text}`);
  const tools = s.toolLog.map((t) => `- \`${t.name}\` → ${JSON.stringify(t.result).slice(0, 220)}`);
  return [
    `# Simulated call — ${r.persona.id}`,
    "",
    `- Started: ${s.startedAt} (${s.afterHours ? "after hours" : "office hours"})`,
    `- Simulated duration: ${Math.floor(r.durationS / 60)}:${String(Math.round(r.durationS % 60)).padStart(2, "0")} · caller turns: ${r.callerTurns} · ended by: ${r.endedBy}${r.dropped ? " (DROPPED)" : ""}`,
    `- Outcome: **${s.evaluation?.outcome ?? s.scope?.status ?? "none"}**${s.evaluation?.declineReason ? ` (${s.evaluation.declineReason})` : ""}${s.booking ? ` · booked ${s.booking.label} with ${s.booking.designer}` : ""}${s.callbackWindow ? ` · callback: ${s.callbackWindow}` : ""}`,
    `- Price guard rewrites: ${s.guardRewrites.length} · LLM calls: ${s.usage.calls} (${s.usage.prompt} in / ${s.usage.output + s.usage.thoughts} out tokens) · median turn latency: ${median(s.turnLatencyMs)} ms`,
    "",
    "## Transcript",
    "",
    ...lines.flatMap((l) => [l, ""]),
    "## Tool calls",
    "",
    ...tools,
    "",
  ].join("\n");
}

function median(xs: number[]) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
