import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A backslash inside a JS template literal is dropped before the SQL reaches Postgres
// (`'^\+?…'` arrives as `'^+?…'` → "invalid regular expression: quantifier operand invalid").
// That broke every post-call hand-off on 9–10 Oct 2026. Use bracket classes like [+] instead.
function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("SQL regexes in template literals", () => {
  it("never rely on a backslash escape", () => {
    const offenders = ["lib", "app", "functions", "server"]
      .flatMap((d) => tsFiles(d))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .map((line, i) => ({ file, line: i + 1, text: line }))
          .filter((l) => /~\*?\s*'[^']*\\[^']*'/.test(l.text)),
      )
      .map((l) => `${l.file}:${l.line}`);
    expect(offenders).toEqual([]);
  });
});
