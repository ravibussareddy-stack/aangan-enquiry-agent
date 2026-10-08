/**
 * Rule 1: pricing.md never reaches the voice agent.
 *
 * Scans everything that can end up in the agent's prompt or context
 * (/agent, lib/voice) for pricing figures and for imports of the pricing
 * source or the server-only budget floor. Phase 3 adds the runtime check
 * on the assembled agent config.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPriceMentions } from "../lib/compliance/price-scan";

const AGENT_SURFACES = ["agent", "lib/voice"];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("pricing isolation", () => {
  const surfaceFiles = AGENT_SURFACES.flatMap(files).filter((f) => !f.endsWith(".test.ts"));

  it.each(surfaceFiles.length ? surfaceFiles : ["(no agent files yet)"])("%s has no price figures", (file) => {
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    expect(findPriceMentions(text)).toEqual([]);
  });

  it.each(surfaceFiles.length ? surfaceFiles : ["(no agent files yet)"])("%s does not import pricing or the budget floor", (file) => {
    if (!existsSync(file)) return;
    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(/pricing\.md|BUDGET_FLOOR|budgetFloor|qualify\/budget/);
  });
});
