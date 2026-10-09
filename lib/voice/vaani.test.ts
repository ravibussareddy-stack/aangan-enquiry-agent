import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeVaaniEvent, parseVaaniTranscript, verifyVaaniWebhook } from "./vaani";

describe("Vaani webhook normalisation (docs payloads)", () => {
  it("call_ended duration is in seconds", () => {
    const e = normalizeVaaniEvent({ event: "call_ended", room_name: "room_1", call_duration: 42.5, end_reason: "AGENT_REQUESTED_DISCONNECT" });
    expect(e).toMatchObject({ kind: "call_ended", providerCallId: "room_1", durationS: 42.5 });
  });

  it("call_postprocessing duration is in MILLISECONDS and transcript is parsed", () => {
    const e = normalizeVaaniEvent({
      event: "call_postprocessing",
      call_id: "outbound-1",
      timestamp: "2026-07-24T13:34:22+00:00",
      data: { call_id: "outbound-1", call_duration: 55150.02, transcript: "[13:33:14] AGENT: Hi!\n\n[13:33:19] USER: Hello" },
    });
    expect(e.kind).toBe("call_completed");
    if (e.kind === "call_completed") {
      expect(e.durationS).toBeCloseTo(55.15, 1);
      expect(e.transcript).toEqual([
        { speaker: "agent", text: "Hi!" },
        { speaker: "caller", text: "Hello" },
      ]);
    }
  });

  it("live payloads (2026-10-09): call_duration is in SECONDS under data on both events", () => {
    const ended = normalizeVaaniEvent({ event: "call_ended", data: { room_name: "webrtc-1", call_duration: 74.709086, end_reason: "Call ended", phone_number: null } });
    expect(ended).toMatchObject({ kind: "call_ended", providerCallId: "webrtc-1", endReason: "Call ended" });
    if (ended.kind === "call_ended") expect(ended.durationS).toBeCloseTo(74.71, 1);
    const post = normalizeVaaniEvent({ event: "call_postprocessing", call_id: "webrtc-1", data: { call_id: "webrtc-1", call_duration: 74.71, transcript: "" } });
    if (post.kind !== "call_completed") throw new Error("expected call_completed");
    expect(post.durationS).toBeCloseTo(74.71, 1); // was 0.07 s — billed 1 minute instead of 2
  });

  it("call_started carries the caller number (E.164)", () => {
    const e = normalizeVaaniEvent({ event: "call_started", room_name: "room_2", phone_number: "09876543210" });
    expect(e).toMatchObject({ kind: "call_started", callerPhone: "+919876543210", direction: "inbound" });
  });

  it("ignores unknown events and missing ids", () => {
    expect(normalizeVaaniEvent({ event: "something_new", room_name: "r" }).kind).toBe("ignored");
    expect(normalizeVaaniEvent({ event: "call_ended" }).kind).toBe("ignored");
  });

  it("parses transcripts without timestamps", () => {
    expect(parseVaaniTranscript("AGENT: Hi\n USER: Yes")).toHaveLength(2);
  });
});

describe("Vaani webhook verification", () => {
  const url = (token?: string) => new URL(`https://x.test/api/voice/events${token ? `?token=${token}` : ""}`);
  afterEach(() => {
    delete process.env.VAANI_WEBHOOK_TOKEN;
    delete process.env.VAANI_WEBHOOK_SECRET;
  });

  it("requires the secret path token when unsigned", () => {
    process.env.VAANI_WEBHOOK_TOKEN = "s3cret";
    expect(verifyVaaniWebhook(new Headers(), "{}", url("s3cret"))).toBe(true);
    expect(verifyVaaniWebhook(new Headers(), "{}", url("wrong"))).toBe(false);
    expect(verifyVaaniWebhook(new Headers(), "{}", url())).toBe(false);
  });

  it("rejects everything when no token is configured", () => {
    expect(verifyVaaniWebhook(new Headers(), "{}", url("anything"))).toBe(false);
  });

  it("verifies the HMAC signature format documented for campaign webhooks", () => {
    process.env.VAANI_WEBHOOK_SECRET = "hk";
    const ts = String(Math.floor(Date.now() / 1000));
    const body = '{"event":"call_ended"}';
    const sig = `sha256=${createHmac("sha256", "hk").update(`${ts}.${body}`).digest("hex")}`;
    expect(verifyVaaniWebhook(new Headers({ "x-vaani-signature": sig, "x-vaani-timestamp": ts }), body, url())).toBe(true);
    expect(verifyVaaniWebhook(new Headers({ "x-vaani-signature": sig, "x-vaani-timestamp": ts }), body + " ", url())).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 600);
    const oldSig = `sha256=${createHmac("sha256", "hk").update(`${old}.${body}`).digest("hex")}`;
    expect(verifyVaaniWebhook(new Headers({ "x-vaani-signature": oldSig, "x-vaani-timestamp": old }), body, url())).toBe(false);
  });
});
