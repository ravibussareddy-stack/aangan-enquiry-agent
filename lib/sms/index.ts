/**
 * SmsProvider. Vaani has no SMS API. 'console' (default, zero-cost) logs the
 * message to sms_messages; 'msg91' sends via MSG91 with a DLT template id.
 * Customers only ever get SMS — never Telegram (brief rule 5).
 */
import { fetchWithRetry } from "../http/retry";
import type { RuntimeConfig } from "../config/runtime";

export interface SmsSendResult {
  provider: "console" | "msg91";
  status: "logged" | "sent" | "failed";
  body: string;
  providerMsgId?: string;
  error?: string;
}

/** Fill {#var#} placeholders in order. */
export function renderTemplate(text: string, vars: string[]): string {
  let i = 0;
  return text.replace(/\{#var#\}/g, () => vars[i++] ?? "");
}

export async function sendSms(cfg: RuntimeConfig, to: string, template: string, vars: string[]): Promise<SmsSendResult> {
  const t = cfg.smsTemplates[template];
  if (!t) throw new Error(`Unknown SMS template ${template}`);
  const body = renderTemplate(t.text, vars);
  if (cfg.smsProvider !== "msg91") {
    console.info(`[sms:console] to ${to}: ${body}`);
    return { provider: "console", status: "logged", body };
  }
  if (!t.dlt_template_id) return { provider: "msg91", status: "failed", body, error: "No DLT template id registered" };
  const res = await fetchWithRetry("https://control.msg91.com/api/v5/flow", {
    method: "POST",
    headers: { authkey: process.env.MSG91_AUTH_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({
      template_id: t.dlt_template_id,
      short_url: "0",
      recipients: [{ mobiles: to.replace(/^\+/, ""), ...Object.fromEntries(vars.map((v, i) => [`var${i + 1}`, v])) }],
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
  return res.ok && json.type !== "error"
    ? { provider: "msg91", status: "sent", body, providerMsgId: json.message }
    : { provider: "msg91", status: "failed", body, error: json.message ?? `HTTP ${res.status}` };
}
