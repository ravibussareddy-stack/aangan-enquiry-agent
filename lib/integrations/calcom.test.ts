/** Cal.com attendee email (live call 2026-10-09: example.com was rejected — email_domain_cannot_receive_mail). */
import { afterEach, describe, expect, it } from "vitest";
import { attendeeEmail } from "./calcom";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe("attendeeEmail", () => {
  it("uses a Gmail + alias of the studio inbox, never example.com", () => {
    delete process.env.STUDIO_DOMAIN;
    process.env.GMAIL_USER = "aangan.studio@gmail.com";
    expect(attendeeEmail("webrtc-1791553983-f34db1b2")).toBe("aangan.studio+lead-3983f34db1b2@gmail.com");
  });

  it("uses the studio's own domain when one is set", () => {
    process.env.STUDIO_DOMAIN = "aanganstudio.in";
    expect(attendeeEmail("abc-123")).toBe("leads+lead-abc123@aanganstudio.in");
  });

  it("ignores the old example.com placeholder and falls back to the founder inbox", () => {
    process.env.STUDIO_DOMAIN = "example.com";
    delete process.env.GMAIL_USER;
    process.env.FOUNDER_EMAILS = "founder@school.edu, other@x.com";
    expect(attendeeEmail("x")).toBe("founder+lead-x@school.edu");
  });
});
