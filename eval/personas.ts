/**
 * Caller personas for simulation, built from the real transcripts: the caller
 * is told what they said on the original call and must stay consistent.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Persona } from "../lib/sim/simulate";

interface CaseFile {
  id: string;
  transcript: { speaker: string; text: string }[];
}

const OVERRIDES: Record<string, Partial<Persona>> = {
  T02: { behaviour: "Ask for a rough ballpark price twice before agreeing to book." },
  T09: {
    existingClient: { name: "Sheetal Deshpande", project: "2BHK Viman Nagar — designer Aryan" },
    behaviour: "You are upset. You want a callback from Nikhil or a senior person, not just anyone.",
  },
  T10: { behaviour: "Volunteer your budget early: 'my budget is 1 to 1.5 lakh maximum for everything'. Confirm it if asked." },
  T13: {
    behaviour:
      "Push hard for a price: ask 'what might it cost?', then 'can't you give me even a rough range?', then 'just tell me per square foot, other studios did'. Only then agree to book.",
  },
  T16: { behaviour: "Start by complaining you called on Monday and nobody got back. If asked, it's a full 3BHK interiors job, done by February." },
  T17: { dropAfterTurns: 2 },
  S07: { language: "Hinglish (Hindi-English mix, Roman script)" },
  S11: {
    behaviour:
      "You're Meenal, an existing client (your 2BHK kitchen in Baner is being done by Aangan). You want to speak to your designer Rohan about the tile samples he sent. It's not a complaint. If asked when he should call: 'today after 6 pm'. Keep it short.",
  },
  S10: {
    behaviour:
      "You are very guarded. You want 'your house done' but refuse to say where ('I'd rather tell the designer'), say you're not sure about timing, won't share a budget, say 'we'll see' about who decides, and you've not looked at the website. Keep answers short. If asked when to call back: 'Saturday morning'.",
  },
  S09: {
    behaviour:
      "You are busy and guarded. Answer in as few words as possible (2–6 words), never volunteer anything not asked, don't know your PIN code, refuse to share a budget ('rather not say'), and only say you own the flat if asked who decides. The flat is a 2BHK in Wakad, about 900 sq ft if pressed, lived-in and available now, needed before February.",
  },
};

const EXTRA_FACTS: Record<string, string> = {
  T01: "Your PIN code is 411038. You and your husband own the flat.",
  T13: "Your PIN is 411007. You own the flat. You'd like it done by April.",
  T10: "Your PIN is 411014. You own the flat. No fixed deadline.",
  T18: "The coworking space is in Baner (PIN 411045). You own the business. No fixed deadline — whenever it can be done. The pod is ready to work on now. You'd rather not share a budget. If asked when to call back: 'tomorrow after 4 pm'.",
};

export function personaFor(id: string, n = 1): Persona {
  const kase = JSON.parse(readFileSync(join(import.meta.dirname, "cases", `${id}.json`), "utf8")) as CaseFile;
  const callerLines = kase.transcript.filter((t) => t.speaker === "caller").map((t) => `- "${t.text}"`);
  const notes = kase.transcript.filter((t) => t.speaker === "note").map((t) => `- ${t.text}`);
  const brief = [
    "On a real call to the studio you said:",
    ...callerLines,
    ...(notes.length ? ["Context:", ...notes] : []),
    EXTRA_FACTS[id] ?? "",
    "Phone: you're calling from your own mobile.",
  ]
    .filter(Boolean)
    .join("\n");
  return { id, brief, phone: `+9190000${String(1000 + n).padStart(5, "0")}`, ...OVERRIDES[id] };
}
