/**
 * Staff notifications: handoff notes, complaint alerts, messages, ops alerts.
 * Email (Gmail) is the staff channel; customers only ever get SMS.
 *
 * - A designer's own note goes to them (DESIGNER_EMAILS); otherwise to the
 *   designers / senior / helpdesk / ops group (lib/staff/recipients.ts).
 * - Action buttons become signed links, one set per recipient, so the
 *   person who clicks is credited (lib/staff/links.ts).
 * - Telegram is a legacy fallback, used only when no email transport is
 *   configured but TELEGRAM_BOT_TOKEN is.
 */
import { gmailConfigured, sendEmail } from "../integrations/email";
import { sendTelegram, telegramConfigured, type Button } from "../integrations/telegram";
import { actionUrl, STAFF_ACTIONS, type StaffAction } from "./links";
import { designerEmail, groupEmails, type StaffGroup } from "./recipients";

export interface StaffNotice {
  /** Send to this designer if they're in DESIGNER_EMAILS, else to `group`. */
  designer?: string | null;
  group: StaffGroup;
  subject: string;
  /** Plain text; the first line is the heading. */
  text: string;
  /** Telegram-style buttons: `data` = "<action>:<leadId>", or a `url` link. */
  buttons?: Button[][];
  /** Legacy Telegram chat for the fallback. */
  telegramChat?: string | null;
}

export interface StaffDelivery {
  channel: string;
  delivered: boolean;
  externalId: string | null;
  recipients: string[];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderStaffEmail(text: string, buttons: Button[][], recipient: string): { html: string; text: string } {
  const [heading, ...lines] = text.split("\n");
  const links: { label: string; url: string; primary: boolean }[] = [];
  for (const b of buttons.flat()) {
    if (b.data) {
      const [a, leadId] = b.data.split(":");
      const url = STAFF_ACTIONS.includes(a as StaffAction) ? actionUrl(a as StaffAction, leadId, recipient) : null;
      if (url) links.push({ label: b.text, url, primary: a === "apr" });
    } else if (b.url && /^https?:\/\//.test(b.url)) {
      links.push({ label: b.text, url: b.url, primary: false });
    }
  }
  const btn = (l: (typeof links)[number]) =>
    `<a href="${esc(l.url)}" style="display:inline-block;margin:0 8px 8px 0;padding:9px 16px;border-radius:999px;text-decoration:none;font-size:14px;${
      l.primary ? "background:#111216;color:#ffffff" : "background:#eef0fb;color:#15161c;border:1px solid #d9ddf3"
    }">${esc(l.label)}</a>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#15161c;max-width:560px">
<p style="font-size:16px;font-weight:600;margin:0 0 10px">${esc(heading)}</p>
${lines.map((l) => (l.trim() ? `<div>${esc(l)}</div>` : `<div style="height:8px"></div>`)).join("\n")}
${links.length ? `<div style="margin-top:16px">${links.map(btn).join("")}</div>` : ""}
<p style="color:#7d8196;font-size:12px;margin-top:18px">Sent by Aangan Studio's AI phone assistant. Action links work for 14 days and ask you to confirm before anything changes.</p>
</div>`;
  const plain = [text, "", ...links.map((l) => `${l.label}: ${l.url}`)].join("\n");
  return { html, text: plain };
}

export async function notifyStaff(n: StaffNotice): Promise<StaffDelivery> {
  const direct = designerEmail(n.designer);
  const recipients = direct ? [direct] : groupEmails(n.group);
  const channel = direct ? "email_dm" : `email_${n.group}`;
  const buttons = n.buttons ?? [];

  if (gmailConfigured() || process.env.RESEND_API_KEY) {
    // One email per recipient so each person's action links credit them.
    const ids: string[] = [];
    for (const to of recipients) {
      const body = renderStaffEmail(n.text, buttons, to);
      const res = await sendEmail({ to, subject: n.subject, ...body });
      if (res.messageId) ids.push(res.messageId);
    }
    return { channel, delivered: recipients.length > 0, externalId: ids[0] ?? null, recipients };
  }
  if (telegramConfigured() && n.telegramChat) {
    const sent = await sendTelegram(n.telegramChat, n.text, buttons);
    return { channel: "telegram", delivered: sent.delivered, externalId: sent.messageId ? `${n.telegramChat}:${sent.messageId}` : null, recipients: [] };
  }
  const body = renderStaffEmail(n.text, buttons, recipients[0] ?? "staff@example.invalid");
  await sendEmail({ to: recipients, subject: n.subject, ...body }); // logs to the console
  return { channel: `${channel}_console`, delivered: false, externalId: null, recipients };
}

/** Ops alerts (failed webhook, handoff, outbound call, brain turn). Never throws. */
export async function alertOps(text: string) {
  try {
    await notifyStaff({ group: "ops", subject: `⚠️ Aangan ops alert: ${text.slice(0, 80)}`, text: `OPS ALERT\n${text.slice(0, 4000)}`, telegramChat: process.env.TELEGRAM_OPS_CHAT_ID });
  } catch (err) {
    console.error("[ops alert failed]", err, text);
  }
}
