/** Resend email (daily founder digest). Logs instead of sending when unconfigured. */
import { fetchWithRetry } from "../http/retry";

export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }) {
  if (!process.env.RESEND_API_KEY || !opts.to) {
    console.info(`[email:console] to ${opts.to || "(no recipient)"} — ${opts.subject}\n${opts.text}`);
    return { sent: false };
  }
  const res = await fetchWithRetry("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ from: process.env.DIGEST_FROM, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { sent: true };
}
