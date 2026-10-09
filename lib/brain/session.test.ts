/** Turn loop guards (live test 2026-10-09: request_callback refused six times in one turn). */
import { describe, expect, it, vi } from "vitest";
import type { GeminiRequest } from "../llm/gemini";

const requests: GeminiRequest[] = [];
vi.mock("../llm/gemini", () => ({
  generate: async (req: GeminiRequest) => {
    requests.push(req);
    const usage = { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 0 };
    // A model that keeps calling request_callback with an invented quote, until tools are switched off.
    if (req.toolMode !== "NONE") {
      const call = { name: "request_callback", args: { window: "anytime", caller_quote: "anytime is fine" } };
      return { text: "", parts: [{ functionCall: call }], functionCalls: [call], usage, model: "fake" };
    }
    return { text: "When are you generally free to take a call?", parts: [{ text: "When are you generally free to take a call?" }], functionCalls: [], usage, model: "fake" };
  },
}));

const { MockCalendar } = await import("../booking/mock-calendar");
const { seedRuntimeConfig } = await import("../config/runtime");
const { MockCrm } = await import("../crm/mock");
const { respond, startSession } = await import("./session");

describe("respond()", () => {
  it("stops a tool that keeps being refused and makes the agent ask the caller", async () => {
    const now = new Date("2026-10-09T12:00:00+05:30");
    const deps = { calendar: new MockCalendar(), crm: new MockCrm(), config: seedRuntimeConfig(), now: () => now };
    const state = startSession(deps, { callId: "loop", provider: "simulated", direction: "inbound", callerPhone: "+919000000009" });
    state.toolLog.push({ name: "lookup_caller", args: {}, result: {}, at: now.toISOString(), ms: 0 }); // skip the server lookup
    state.lookup = { existingClient: false, contactId: null, name: null, openProject: null, lastStage: null };

    const turn = await respond(state, "It's 524003", deps);

    const callbacks = state.toolLog.filter((t) => t.name === "request_callback");
    expect(callbacks.length).toBe(2); // two real refusals, then the guard steps in
    expect(requests.at(-1)?.toolMode).toBe("NONE");
    expect(turn.text).toMatch(/when are you generally free/i);
    expect(requests.length).toBeLessThanOrEqual(4);
  });
});
