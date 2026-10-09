/**
 * Deliver a non-enquiry call message by email: to the named designer (if they're
 * in DESIGNER_EMAILS, else the designers), or to the helpdesk for "other".
 */
import { db } from "../db/client";
import { notifyStaff } from "../staff/notify";
import { TZ } from "../time/ist";

export async function deliverMessage(messageId: string): Promise<void> {
  const { rows } = await db().query<{
    intent: string;
    caller_name: string | null;
    phone: string;
    for_person: string | null;
    about: string;
    callback_window: string | null;
    created_at: Date;
    designer_id: string | null;
    designer_name: string | null;
    designer_chat: string | null;
  }>(
    `select m.intent, m.caller_name, m.phone, m.for_person, m.about, m.callback_window, m.created_at,
            d.id designer_id, d.name designer_name, d.telegram_chat_id::text designer_chat
       from call_messages m
       left join lateral (
         select * from designers d
          where m.for_person is not null and d.active
            and (d.name ilike m.for_person || '%' or m.for_person ilike split_part(d.name, ' ', 1) || '%')
          limit 1
       ) d on true
      where m.id = $1`,
    [messageId],
  );
  const m = rows[0];
  if (!m) return;
  const when = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(m.created_at);
  const heading = { existing_project_update: "MESSAGE · existing project", specific_designer: "MESSAGE · asked for you", other: "MESSAGE · general" }[m.intent] ?? "MESSAGE";
  const text = [
    `${heading}${m.designer_name ? ` · for ${m.designer_name}` : m.for_person ? ` · for ${m.for_person}` : ""}`,
    `${m.caller_name ?? "Caller"} · ${m.phone} · called ${when}`,
    `About: ${m.about}`,
    `Free times: ${m.callback_window ?? "not given"} · told "as soon as possible"`,
  ].join("\n");

  const sent = await notifyStaff({
    designer: m.intent === "other" ? null : (m.designer_name ?? m.for_person),
    group: m.intent === "other" ? "helpdesk" : "designers",
    subject: `Message from ${m.caller_name ?? "a caller"}${m.designer_name ? ` for ${m.designer_name}` : ""}`,
    text,
    telegramChat: m.intent === "other" ? process.env.TELEGRAM_HELPDESK_CHAT_ID : (m.designer_chat ?? process.env.TELEGRAM_DESIGNERS_CHAT_ID),
  });
  await db().query("update call_messages set for_designer_id = $2, delivered_to = $3, sent_at = now() where id = $1", [
    messageId,
    m.designer_id,
    sent.delivered ? sent.channel : "console",
  ]);
}
