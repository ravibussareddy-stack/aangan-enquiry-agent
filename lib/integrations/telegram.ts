/**
 * Telegram Bot API — staff only (designers, seniors, ops). Never customers.
 * Webhook verification: X-Telegram-Bot-Api-Secret-Token (set via setWebhook).
 * When TELEGRAM_BOT_TOKEN is unset, messages are logged instead (zero-cost / dev).
 */
import { timingSafeEqual } from "node:crypto";
import { fetchWithRetry } from "../http/retry";

export function telegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

async function api<T>(method: string, body: unknown): Promise<T> {
  const res = await fetchWithRetry(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

export interface Button {
  text: string;
  data?: string;
  url?: string;
}

function keyboard(buttons: Button[][]) {
  // Telegram rejects non-public URLs on buttons; drop those in local dev.
  const rows = buttons
    .map((row) => row.filter((b) => b.data || (b.url && /^https:\/\//.test(b.url) && !/localhost|127\.0\.0\.1/.test(b.url))))
    .filter((row) => row.length);
  return rows.length ? { inline_keyboard: rows.map((row) => row.map((b) => (b.data ? { text: b.text, callback_data: b.data } : { text: b.text, url: b.url }))) } : undefined;
}

export async function sendTelegram(chatId: string | number, text: string, buttons: Button[][] = []): Promise<{ messageId: number | null; delivered: boolean }> {
  if (!telegramConfigured() || !chatId) {
    console.info(`[telegram:console] → ${chatId || "(no chat)"}\n${text}`);
    return { messageId: null, delivered: false };
  }
  const msg = await api<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: keyboard(buttons),
  });
  return { messageId: msg.message_id, delivered: true };
}

export async function answerCallback(callbackQueryId: string, text: string) {
  if (!telegramConfigured()) return;
  await api("answerCallbackQuery", { callback_query_id: callbackQueryId, text });
}

export async function editMessageText(chatId: string | number, messageId: number, text: string, buttons: Button[][] = []) {
  if (!telegramConfigured()) return;
  await api("editMessageText", { chat_id: chatId, message_id: messageId, text, disable_web_page_preview: true, reply_markup: keyboard(buttons) });
}

export function verifyTelegramSecret(header: string | null): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(secret);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Ops alerts (Phase 6). Falls back to console. */
export async function alertOps(text: string) {
  try {
    await sendTelegram(process.env.TELEGRAM_OPS_CHAT_ID ?? "", `⚠️ OPS · ${text}`.slice(0, 4000));
  } catch (err) {
    console.error("[ops alert failed]", err, text);
  }
}
