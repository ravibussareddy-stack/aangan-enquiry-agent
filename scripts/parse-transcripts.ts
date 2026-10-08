/**
 * Parse phone transcripts T01–T20 from the seed PDF's extracted text into
 * eval/cases/Txx.json. Re-running keeps any hand-written `expected` and
 * `fixture` already in the case files.
 *
 *   npm run parse:transcripts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = "seed/enquiries-sep-2026.extracted.txt";
const OUT_DIR = "eval/cases";

const MONTHS: Record<string, string> = { September: "09", October: "10" };

type Speaker = "agent" | "caller" | "note";

function clean(raw: string): string {
  // The PDF extractor emits one word per line; collapse all whitespace.
  return raw.replace(/=====PAGE=====/g, " ").replace(/\s+/g, " ").trim();
}

function parseTurns(body: string): { speaker: Speaker; text: string }[] {
  const parts = body.split(/\s*(Front Desk:|Caller:|Note:|First call —|Second call —)\s*/);
  const turns: { speaker: Speaker; text: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const tag = parts[i];
    const text = parts[i + 1]?.trim() ?? "";
    if (tag.startsWith("First call") || tag.startsWith("Second call")) {
      turns.push({ speaker: "note", text: `${tag} ${text}`.trim() });
      continue;
    }
    const speaker: Speaker = tag === "Front Desk:" ? "agent" : tag === "Caller:" ? "caller" : "note";
    if (text) turns.push({ speaker, text });
  }
  return turns;
}

function main() {
  const text = clean(readFileSync(SOURCE, "utf8"));
  const phone = text.slice(text.indexOf("SECTION 1"), text.indexOf("SECTION 2"));
  const header = /(T\d{2}) · Phone · (\d{1,2}) (\w+) · (\d{1,2}):(\d{2})(am|pm)/g;
  const matches = [...phone.matchAll(header)];
  mkdirSync(OUT_DIR, { recursive: true });

  matches.forEach((m, i) => {
    const [, id, day, month, hh, mm, ampm] = m;
    const end = i + 1 < matches.length ? matches[i + 1].index : phone.length;
    const block = phone.slice(m.index, end);
    const headerLine = block.slice(0, block.search(/Front Desk:|Missed call|First call/)).trim();

    let hour = Number(hh) % 12;
    if (ampm === "pm") hour += 12;
    const startedAt = `2026-${MONTHS[month]}-${day.padStart(2, "0")}T${String(hour).padStart(2, "0")}:${mm}:00+05:30`;
    const dur = headerLine.match(/(\d+) min (\d+) sec/);

    const path = join(OUT_DIR, `${id}.json`);
    const existing = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
    const turns = parseTurns(block);
    const kase = {
      id,
      channel: "phone",
      synthetic: false,
      source: "seed/enquiries-sep-2026.pdf",
      header: headerLine,
      call_started_at: startedAt,
      duration_s: dur ? Number(dur[1]) * 60 + Number(dur[2]) : null,
      transcript: turns.length ? turns : [{ speaker: "note", text: block.replace(headerLine, "").trim() }],
      expected: existing.expected ?? null,
      fixture: existing.fixture ?? null,
    };
    writeFileSync(path, JSON.stringify(kase, null, 2) + "\n");
  });
  console.log(`Wrote ${matches.length} cases to ${OUT_DIR}`);
}

main();
