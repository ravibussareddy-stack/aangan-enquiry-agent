"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db/client";
import { applyReviewDecision, routeLead } from "@/lib/review/decide";
import { verifyAction } from "@/lib/staff/links";
import { staffNameFor } from "@/lib/staff/recipients";

const DONE: Record<string, string> = {
  apr: "Approved — the booking call is scheduled.",
  rej: "Declined — the caller gets the polite SMS.",
  dsg: "Sent to designer review.",
  adm: "Sent to admin review.",
};

/** Runs only on the confirm button (POST); the signed token is the authorisation. */
export async function confirmStaffAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const v = verifyAction(token);
  if (!v.ok) redirect(`/r/${token}?msg=${encodeURIComponent(v.reason)}`);
  const { a, l: leadId, r: email } = v.claim;
  const reviewer = staffNameFor(email);
  const designer = await db().query<{ id: string }>("select id from designers where name = $1 and active", [reviewer]);

  const res =
    a === "dsg" || a === "adm"
      ? await routeLead({ leadId, to: a === "dsg" ? "designer" : "admin" })
      : await applyReviewDecision({
          leadId,
          decision: a === "apr" ? "approved" : "rejected",
          source: "email",
          reviewer,
          reviewerDesignerId: designer.rows[0]?.id ?? null,
        });
  if (res.applied && (a === "apr" || a === "rej")) {
    await db().query("update handoffs set action_taken = $2 where lead_id = $1 and channel like 'email%'", [leadId, a === "apr" ? "approved" : "rejected"]);
  }
  redirect(`/r/${token}?msg=${encodeURIComponent(res.applied ? DONE[a] : `Nothing changed: ${res.reason ?? "already handled"}.`)}&ok=${res.applied ? 1 : 0}`);
}
