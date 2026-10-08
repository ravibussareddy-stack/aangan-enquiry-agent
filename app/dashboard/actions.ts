"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer, hasAccess } from "@/lib/auth/viewer";
import { asUser } from "@/lib/db/as-user";
import { runInsights } from "@/lib/insights/narrative";
import { applyReviewDecision, routeLead } from "@/lib/review/decide";
import { runtimeConfigFromRows, clearRuntimeConfigCache } from "@/lib/config/runtime";
import { db } from "@/lib/db/client";

async function founder() {
  const v = await getViewer();
  if (!v || v.role !== "founder") throw new Error("Founder only");
  return v;
}

export async function refreshInsights() {
  await founder();
  try {
    await runInsights({ triggeredBy: "refresh" });
  } catch (err) {
    redirect(`/dashboard?insights_error=${encodeURIComponent((err as Error).message)}`);
  }
  revalidatePath("/dashboard");
}

export async function decideReview(formData: FormData) {
  const v = await getViewer();
  if (!v || !hasAccess(v)) throw new Error("Not allowed");
  const leadId = String(formData.get("leadId"));
  const decision = formData.get("decision") === "approved" ? "approved" : "rejected";
  // RLS check: the viewer must be able to see this lead in review.
  const visible = await asUser(v.userId, (c) => c.query("select 1 from leads where id = $1 and status in ('review', 'callback')", [leadId]));
  if (!visible.rowCount) throw new Error("Lead not visible or not in review");
  await applyReviewDecision({ leadId, decision, source: "dashboard", reviewer: v.name ?? v.email, reviewerDesignerId: v.designerId });
  revalidatePath("/dashboard", "layout");
}

export async function saveConfig(formData: FormData) {
  const v = await founder();
  const key = String(formData.get("key"));
  let value: unknown;
  try {
    value = JSON.parse(String(formData.get("value")));
  } catch {
    redirect(`/dashboard/settings?error=${encodeURIComponent(`${key}: not valid JSON`)}`);
  }
  const { rows } = await db().query<{ key: string; value: unknown }>("select key, value from config");
  const merged = { ...Object.fromEntries(rows.map((r) => [r.key, r.value])), [key]: value };
  try {
    runtimeConfigFromRows(merged); // validates thresholds/flags before saving
  } catch (err) {
    redirect(`/dashboard/settings?error=${encodeURIComponent(`${key}: ${(err as Error).message.slice(0, 200)}`)}`);
  }
  await asUser(v.userId, (c) => c.query("update config set value = $2, updated_by = $3 where key = $1", [key, JSON.stringify(value), v.userId]));
  clearRuntimeConfigCache();
  revalidatePath("/dashboard/settings");
  redirect(`/dashboard/settings?saved=${encodeURIComponent(key)}`);
}

export async function addRate(formData: FormData) {
  const v = await founder();
  const component = String(formData.get("component"));
  const unit = String(formData.get("unit"));
  const rate = Number(formData.get("unit_rate_inr"));
  const from = String(formData.get("effective_from"));
  if (!component || !unit || !Number.isFinite(rate) || rate < 0 || !from) {
    redirect(`/dashboard/settings?error=${encodeURIComponent("Rate: all fields required, rate ≥ 0")}`);
  }
  await asUser(v.userId, (c) =>
    c.query("insert into rates (component, unit, unit_rate_inr, effective_from, note) values ($1,$2,$3,$4,$5)", [
      component,
      unit,
      rate,
      new Date(`${from}T00:00:00+05:30`),
      String(formData.get("note") ?? "") || null,
    ]),
  );
  revalidatePath("/dashboard/settings");
  redirect(`/dashboard/settings?saved=rate`);
}

export async function routeLeadAction(formData: FormData) {
  const v = await getViewer();
  if (!v || !hasAccess(v)) throw new Error("Not allowed");
  const leadId = String(formData.get("leadId"));
  const to = String(formData.get("to"));
  if (!["designer", "admin", "callback"].includes(to)) throw new Error("Bad route");
  // Designers may only send leads to admin review; routing to designers/helpdesk is the founder's.
  if (v.role !== "founder" && to !== "admin") throw new Error("Founder only");
  const visible = await asUser(v.userId, (c) => c.query("select 1 from leads where id = $1 and status in ('review', 'callback')", [leadId]));
  if (!visible.rowCount) throw new Error("Lead not visible or not awaiting a decision");
  await routeLead({ leadId, to: to as "designer" | "admin" | "callback" });
  revalidatePath("/dashboard", "layout");
}
