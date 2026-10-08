/**
 * Telegram inline-button callbacks (Approve / Reject on review leads).
 * Verified with X-Telegram-Bot-Api-Secret-Token; idempotent per callback id;
 * the reviewer is the Telegram user who pressed the button.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { answerCallback, editMessageText, verifyTelegramSecret } from "@/lib/integrations/telegram";
import { applyReviewDecision, routeLead } from "@/lib/review/decide";
import { once } from "@/lib/webhooks/idempotency";

interface Update {
  update_id: number;
  callback_query?: {
    id: string;
    from: { id: number; username?: string; first_name?: string };
    data?: string;
    message?: { message_id: number; chat: { id: number }; text?: string };
  };
}

export async function POST(req: Request) {
  if (!verifyTelegramSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const update = (await req.json()) as Update;
  const cq = update.callback_query;
  if (!cq?.data) return NextResponse.json({ ok: true });

  const [action, leadId] = cq.data.split(":");
  if (!["apr", "rej", "dsg", "adm"].includes(action) || !/^[0-9a-f-]{36}$/.test(leadId ?? "")) {
    await answerCallback(cq.id, "Unknown action");
    return NextResponse.json({ ok: true });
  }

  await once("telegram", `cb:${cq.id}`, update, async () => {
    const designer = await db().query<{ id: string; name: string }>("select id, name from designers where telegram_user_id = $1", [cq.from.id]);
    const reviewer = designer.rows[0]?.name ?? cq.from.username ?? cq.from.first_name ?? String(cq.from.id);
    if (action === "dsg" || action === "adm") {
      const routed = await routeLead({ leadId, to: action === "dsg" ? "designer" : "admin" });
      await answerCallback(cq.id, routed.applied ? `Sent to ${action === "dsg" ? "designer" : "admin"} review` : (routed.reason ?? "Not applied"));
      if (routed.applied && cq.message) {
        await editMessageText(cq.message.chat.id, cq.message.message_id, `${cq.message.text ?? ""}\n\n→ ${action === "dsg" ? "Designer" : "Admin"} review (by ${reviewer})`);
      }
      return;
    }
    const decision = action === "apr" ? "approved" : "rejected";
    const res = await applyReviewDecision({ leadId, decision, source: "telegram", reviewer, reviewerDesignerId: designer.rows[0]?.id ?? null });
    await answerCallback(cq.id, res.applied ? (decision === "approved" ? "Approved — booking call scheduled" : "Rejected — SMS sent") : (res.reason ?? "Not applied"));
    if (res.applied && cq.message) {
      const stamp = `\n\n${decision === "approved" ? "✅ Approved" : "❌ Rejected"} by ${reviewer}`;
      await editMessageText(cq.message.chat.id, cq.message.message_id, `${cq.message.text ?? ""}${stamp}`);
      await db().query("update handoffs set action_taken = $2 where lead_id = $1 and channel like 'telegram%'", [leadId, decision]);
    }
  });
  return NextResponse.json({ ok: true });
}
