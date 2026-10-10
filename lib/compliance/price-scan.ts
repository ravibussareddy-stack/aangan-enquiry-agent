/**
 * Price-leak scan (brief rule 2). Flags rupee amounts, lakh/crore, and
 * per-sq-ft language spoken by the AGENT. Caller turns are ignored.
 *
 * One exemption: the agent may repeat a figure the caller has already said
 * ("Just to confirm — six lakh?", "With around 25 lakh in mind, I can book…").
 * An agent turn whose amounts were ALL said by the caller first, with no
 * per-sq-ft talk and no judgement of the figure against cost ("1.5 lakh would be
 * below what this costs" tells the caller about pricing — T10), is recorded as an
 * echo, not a leak. Any other figure is a leak.
 * (The live call on 2026-10-10 had "25 lakhs" restated in a longer reply, and the
 * old short-confirmation-only rule replaced the whole reply, booking offer included.)
 */

export interface PriceMention {
  text: string;
  pattern: string;
}

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "rupee_amount", re: /(?:₹|\brs\.?|\binr)\s*[\d,.]+/gi },
  { name: "rupees_word", re: /\b(?:rupees?|rupaye|rupay)\b|रुपये|रुपए|रुपया/gi },
  { name: "lakh_crore", re: /\b(?:lakhs?|lacs?|crores?|cr)\b|लाख|करोड़|कोटी/gi },
  {
    name: "per_area",
    re: /\b(?:per|a|\/)\s*(?:sq\.?\s*(?:ft|feet|foot)|sqft|square\s*(?:foot|feet|ft))\b|\bpsf\b|प्रति\s*वर्ग\s*फ(?:ुट|ीट)|प्रति\s*चौरस\s*फूट/gi,
  },
];

export function findPriceMentions(text: string): PriceMention[] {
  return PATTERNS.flatMap(({ name, re }) =>
    [...text.matchAll(re)].map((m) => ({ text: m[0].trim(), pattern: name })),
  );
}

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8",
  nine: "9", ten: "10", fifteen: "15", twenty: "20", "twenty five": "25", thirty: "30",
  forty: "40", fifty: "50", "one and a half": "1.5", "ek": "1", "do": "2", "teen": "3",
  "char": "4", "paanch": "5", "chhe": "6", "saat": "7", "aath": "8", "dus": "10",
};

/** Normalised amount tokens: "1.5 lakh", "6 lakh", "600000". */
export function amounts(text: string): string[] {
  let t = text.toLowerCase().replace(/(\d),(?=\d)/g, "$1");
  for (const [word, digit] of Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    t = t.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }
  const out = new Set<string>();
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr)\b/g)) {
    out.add(`${m[1]} ${m[2].startsWith("cr") ? "crore" : "lakh"}`);
  }
  for (const m of t.matchAll(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/g)) out.add(m[1]);
  return [...out];
}

/** Words that judge a caller's figure against what the work costs. */
const COST_JUDGEMENT = /\b(below|above|under|over|too (?:low|high|little|much)|not enough|enough|short of|costs?|costing|afford|cheap|expensive|price[ds]?|pricing|rates?|realistic|align)\b/i;

export interface TranscriptTurn {
  speaker: "agent" | "caller" | "note";
  text: string;
}

export interface PriceLeakResult {
  leak: boolean;
  hits: (PriceMention & { turn: number })[];
  echoes: { turn: number; text: string }[];
}

/**
 * `approved`: server-written lines (the typical-budget line) that may carry
 * figures. They are removed from agent turns before scanning — any OTHER
 * figure is still a leak.
 */
export function scanTranscriptForPriceLeak(turns: TranscriptTurn[], approved: string[] = []): PriceLeakResult {
  const hits: PriceLeakResult["hits"] = [];
  const echoes: PriceLeakResult["echoes"] = [];
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const approvedNorm = approved.filter(Boolean).map(norm);

  turns.forEach((turn, i) => {
    if (turn.speaker !== "agent") return;
    let text = norm(turn.text);
    for (const line of approvedNorm) text = text.split(line).join(" ");
    const mentions = findPriceMentions(text);
    if (!mentions.length) return;

    // Figures the caller has said at any point before this turn.
    const spoken = amounts(text);
    const callerSaid = new Set(turns.slice(0, i).filter((t) => t.speaker === "caller").flatMap((t) => amounts(t.text)));
    const isEcho =
      spoken.length > 0 &&
      spoken.every((a) => callerSaid.has(a)) &&
      !COST_JUDGEMENT.test(text) &&
      !mentions.some((m) => m.pattern === "per_area");

    if (isEcho) echoes.push({ turn: i, text: turn.text });
    else hits.push(...mentions.map((m) => ({ ...m, turn: i })));
  });

  return { leak: hits.length > 0, hits, echoes };
}

/** Parse a provider transcript string ("AGENT: …\nUSER: …") into turns. */
export function parseLabelledTranscript(text: string): TranscriptTurn[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, ""))
    .map((line): TranscriptTurn | null => {
      const m = line.match(/^(AGENT|ASSISTANT|BOT|USER|CALLER|CUSTOMER)\s*:\s*(.*)$/i);
      if (!m) return null;
      return { speaker: /^(AGENT|ASSISTANT|BOT)$/i.test(m[1]) ? "agent" : "caller", text: m[2] };
    })
    .filter((t): t is TranscriptTurn => t !== null);
}

/** Rupee value of a normalised amount token ("1.5 lakh" → 150000). */
export function amountToInr(token: string): number {
  const [n, unit] = token.split(" ");
  const v = Number(n);
  return unit === "crore" ? v * 1e7 : unit === "lakh" ? v * 1e5 : v;
}

/**
 * Deterministic budget confirmation: the caller stated an amount and a later
 * agent turn repeated the same amount (and the caller didn't give a different one after).
 */
export function budgetEchoed(turns: TranscriptTurn[], budgetInr: number | null): boolean {
  if (budgetInr == null) return false;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].speaker !== "caller") continue;
    const said = amounts(turns[i].text).filter((a) => Math.abs(amountToInr(a) - budgetInr) < 1);
    if (!said.length) continue;
    const echo = turns.slice(i + 1).find((t) => t.speaker === "agent" && amounts(t.text).some((a) => said.includes(a)));
    if (echo) return true;
  }
  return false;
}
