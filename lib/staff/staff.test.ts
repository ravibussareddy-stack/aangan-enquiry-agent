import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signAction, verifyAction } from "./links";
import { renderStaffEmail } from "./notify";
import { designerEmail, groupEmails, staffNameFor } from "./recipients";

const LEAD = "92b679ca-8de1-4327-872f-6c7c7a06faff";
const saved = { ...process.env };

beforeEach(() => {
  process.env.STAFF_LINK_SECRET = "test-secret";
  process.env.APP_BASE_URL = "https://aangan.example";
  process.env.FOUNDER_EMAILS = "founder@example.com";
  process.env.DESIGNER_EMAILS = "asha@example.com:Asha Kulkarni, rohan@example.com:Rohan Joshi";
  delete process.env.STAFF_EMAIL_SENIOR;
  delete process.env.STAFF_EMAIL_DESIGNERS;
});
afterEach(() => {
  process.env = { ...saved };
});

describe("staff action links", () => {
  it("round-trips a signed action", () => {
    const v = verifyAction(signAction("apr", LEAD, "Asha@Example.com"));
    expect(v).toMatchObject({ ok: true, claim: { a: "apr", l: LEAD, r: "asha@example.com" } });
  });

  it("rejects a tampered link", () => {
    const [body, sig] = signAction("rej", LEAD, "asha@example.com").split(".");
    const forged = Buffer.from(Buffer.from(body, "base64url").toString().replace('"rej"', '"apr"')).toString("base64url");
    expect(verifyAction(`${forged}.${sig}`).ok).toBe(false);
  });

  it("rejects a link signed with another secret", () => {
    const token = signAction("apr", LEAD, "asha@example.com");
    process.env.STAFF_LINK_SECRET = "different";
    expect(verifyAction(token).ok).toBe(false);
  });

  it("expires after 14 days", () => {
    const token = signAction("apr", LEAD, "asha@example.com", Date.now());
    expect(verifyAction(token, Date.now() + 13 * 86_400_000).ok).toBe(true);
    expect(verifyAction(token, Date.now() + 15 * 86_400_000)).toMatchObject({ ok: false });
  });
});

describe("staff recipients", () => {
  it("finds a designer by full or first name and credits them", () => {
    expect(designerEmail("Asha Kulkarni")).toBe("asha@example.com");
    expect(designerEmail("Rohan")).toBe("rohan@example.com");
    expect(designerEmail("Nikhil")).toBeNull();
    expect(staffNameFor("ROHAN@example.com")).toBe("Rohan Joshi");
  });

  it("falls back to the founder for seniors, and to all designers for the team", () => {
    expect(groupEmails("senior")).toEqual(["founder@example.com"]);
    expect(groupEmails("designers")).toEqual(["asha@example.com", "rohan@example.com"]);
    process.env.STAFF_EMAIL_SENIOR = "nikhil@example.com, meera@example.com";
    expect(groupEmails("senior")).toEqual(["nikhil@example.com", "meera@example.com"]);
  });
});

describe("staff email rendering", () => {
  it("turns buttons into personal signed links and escapes the note", () => {
    const { html, text } = renderStaffEmail(
      "NEW LEAD · Review\nScope: <script>kitchen</script>",
      [[{ text: "✅ Approve", data: `apr:${LEAD}` }, { text: "❌ Reject", data: `rej:${LEAD}` }], [{ text: "Transcript", url: "https://aangan.example/dashboard/leads/x" }]],
      "asha@example.com",
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    const links = [...html.matchAll(/href="https:\/\/aangan\.example\/r\/([^"]+)"/g)].map((m) => verifyAction(m[1]));
    expect(links.map((l) => l.ok && l.claim.a)).toEqual(["apr", "rej"]);
    expect(links.every((l) => l.ok && l.claim.r === "asha@example.com")).toBe(true);
    expect(text).toContain("Transcript: https://aangan.example/dashboard/leads/x");
  });
});
