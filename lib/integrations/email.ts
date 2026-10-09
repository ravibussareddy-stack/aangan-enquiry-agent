/**
 * Outgoing email (staff only — customers only ever get SMS).
 * Gmail SMTP with an App Password when GMAIL_USER + GMAIL_APP_PASSWORD are set
 * (free, ~500 recipients/day), else Resend, else logged to the console.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { sendEmail as sendViaResend } from "./resend";

export interface Email {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export function gmailConfigured(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

let transport: Transporter | undefined;
function gmail(): Transporter {
  return (transport ??= nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "") },
  }));
}

export async function sendEmail(email: Email): Promise<{ sent: boolean; via: "gmail" | "resend" | "console"; messageId: string | null }> {
  const to = (Array.isArray(email.to) ? email.to : [email.to]).map((s) => s.trim()).filter(Boolean);
  if (to.length && gmailConfigured()) {
    const info = await gmail().sendMail({
      from: { name: process.env.GMAIL_FROM_NAME ?? "Aangan Studio", address: process.env.GMAIL_USER! },
      to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    });
    return { sent: true, via: "gmail", messageId: info.messageId ?? null };
  }
  if (to.length && process.env.RESEND_API_KEY) {
    for (const addr of to) await sendViaResend({ to: addr, subject: email.subject, html: email.html, text: email.text });
    return { sent: true, via: "resend", messageId: null };
  }
  console.info(`[email:console] to ${to.join(", ") || "(no recipient)"} — ${email.subject}\n${email.text}`);
  return { sent: false, via: "console", messageId: null };
}
