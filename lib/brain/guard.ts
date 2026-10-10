/**
 * Pre-speech price guard. Every agent reply passes through here BEFORE it is
 * sent to TTS. A sentence carrying a price (₹ amount, lakh/crore, per-sq-ft…) is
 * dropped; the rest of the reply is still spoken, so a booking offer isn't lost
 * with it. Only when nothing safe is left is the reply replaced with the mandated
 * deflection line. Figures the caller said first, and server-approved lines (the
 * typical-budget line), are allowed.
 */
import { scanTranscriptForPriceLeak } from "../compliance/price-scan";

export interface GuardResult {
  text: string;
  rewritten: boolean;
}

/** `callerText` = everything the caller has said so far (one string or a list of turns). */
export function guardUtterance(draft: string, callerText: string | string[] | null, deflection: string, approved: string[] = []): GuardResult {
  const callerTurns = (Array.isArray(callerText) ? callerText : callerText ? [callerText] : []).map((text) => ({ speaker: "caller" as const, text }));
  const leaks = (text: string) => scanTranscriptForPriceLeak([...callerTurns, { speaker: "agent" as const, text }], approved).leak;
  if (!leaks(draft)) return { text: draft, rewritten: false };

  // Approved lines span several sentences, so keep them whole; check the rest sentence by sentence.
  const kept: string[] = [];
  for (const piece of splitAround(draft.replace(/\s+/g, " ").trim(), approved)) {
    if (piece.approved) kept.push(piece.text);
    else kept.push(...(piece.text.match(/[^.!?]+[.!?]*/g) ?? []).map((s) => s.trim()).filter((s) => s && !leaks(s)));
  }
  const rest = kept.join(" ").trim();
  return { text: /[a-z]/i.test(rest) ? rest : deflection, rewritten: true };
}

function splitAround(text: string, approved: string[]): { text: string; approved: boolean }[] {
  const lines = approved.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const out: { text: string; approved: boolean }[] = [];
  let rest = text;
  while (rest) {
    const hit = lines.map((l) => ({ l, i: rest.indexOf(l) })).filter((h) => h.i >= 0).sort((a, b) => a.i - b.i)[0];
    if (!hit) {
      out.push({ text: rest, approved: false });
      break;
    }
    if (hit.i > 0) out.push({ text: rest.slice(0, hit.i), approved: false });
    out.push({ text: hit.l, approved: true });
    rest = rest.slice(hit.i + hit.l.length);
  }
  return out;
}
