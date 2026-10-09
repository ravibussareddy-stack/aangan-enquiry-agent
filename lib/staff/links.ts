/**
 * Signed action links for staff emails (replace Telegram's inline buttons).
 * A link names one action on one lead for one recipient and expires after
 * 14 days. Opening it shows a confirm page — nothing changes on GET, because
 * mail scanners open links automatically.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type StaffAction = "apr" | "rej" | "dsg" | "adm";
export const STAFF_ACTIONS: StaffAction[] = ["apr", "rej", "dsg", "adm"];

export interface ActionClaim {
  a: StaffAction;
  l: string; // lead id
  r: string; // recipient email (credited as the reviewer)
  e: number; // expiry, epoch seconds
}

const TTL_S = 14 * 86_400;

function key(): Buffer {
  const base = process.env.STAFF_LINK_SECRET ?? process.env.NEON_AUTH_COOKIE_SECRET;
  if (!base) throw new Error("STAFF_LINK_SECRET (or NEON_AUTH_COOKIE_SECRET) is not set");
  // Domain-separated so a link signature can never double as anything else.
  return createHmac("sha256", base).update("aangan-staff-links-v1").digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signAction(a: StaffAction, leadId: string, recipient: string, now = Date.now()): string {
  const body = b64(JSON.stringify({ a, l: leadId, r: recipient.toLowerCase(), e: Math.floor(now / 1000) + TTL_S } satisfies ActionClaim));
  return `${body}.${b64(createHmac("sha256", key()).update(body).digest())}`;
}

export function verifyAction(token: string, now = Date.now()): { ok: true; claim: ActionClaim } | { ok: false; reason: string } {
  const [body, sig] = token.split(".");
  if (!body || !sig) return { ok: false, reason: "This link is incomplete." };
  const want = createHmac("sha256", key()).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "This link isn't valid." };
  let claim: ActionClaim;
  try {
    claim = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "This link isn't valid." };
  }
  if (!STAFF_ACTIONS.includes(claim.a) || !/^[0-9a-f-]{36}$/.test(claim.l)) return { ok: false, reason: "This link isn't valid." };
  if (claim.e * 1000 < now) return { ok: false, reason: "This link has expired — use the dashboard instead." };
  return { ok: true, claim };
}

export function actionUrl(a: StaffAction, leadId: string, recipient: string): string | null {
  const base = process.env.APP_BASE_URL;
  return base ? `${base.replace(/\/$/, "")}/r/${signAction(a, leadId, recipient)}` : null;
}
