/**
 * Pre-speech price guard. Every agent reply passes through here BEFORE it is
 * sent to TTS. If it contains a price (₹ amount, lakh/crore, per-sq-ft…) it is
 * replaced with the mandated deflection line — unless it is a short
 * confirmation echoing the caller's own budget figure.
 */
import { scanTranscriptForPriceLeak } from "../compliance/price-scan";

export interface GuardResult {
  text: string;
  rewritten: boolean;
}

/** `callerText` = everything the caller has said so far (one string or a list of turns). */
export function guardUtterance(draft: string, callerText: string | string[] | null, deflection: string, approved: string[] = []): GuardResult {
  const callerTurns = (Array.isArray(callerText) ? callerText : callerText ? [callerText] : []).map((text) => ({ speaker: "caller" as const, text }));
  const scan = scanTranscriptForPriceLeak([...callerTurns, { speaker: "agent" as const, text: draft }], approved);
  return scan.leak ? { text: deflection, rewritten: true } : { text: draft, rewritten: false };
}
