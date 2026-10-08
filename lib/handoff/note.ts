/**
 * Designer handoff note — server-side template from stored fields (no LLM),
 * plus the provider's call summary on the "Watch for" line (brief §6).
 */
import type { LeadExtraction } from "../schema/lead";
import { maskPhone } from "../phone";
import { TZ } from "../time/ist";

export interface NoteInput {
  leadId: string;
  status: "qualified" | "review" | "complaint" | "callback";
  extraction: LeadExtraction;
  phone: string;
  calledAt: Date;
  inArea: string;
  budgetFlag: string | null;
  flags: string[];
  booking: { label: string; designer: string | null } | null;
  summary: string | null;
  repeatCaller: boolean;
  dealUrl: string | null;
  transcriptUrl: string | null;
  complaint?: { summary: string; wantsSenior: string | null } | null;
  /** Intake-sheet fields not captured on the call (labels) — the designer should ask. */
  missing?: string[];
  dealHealth?: { score: number; band: string } | null;
  callbackWindow?: string | null;
  /** Mask the phone number (group chats). */
  mask?: boolean;
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export function buildNote(n: NoteInput): { text: string; buttons: { text: string; data?: string; url?: string }[][] } {
  const x = n.extraction;
  const when = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(n.calledAt);
  const phone = n.mask ? maskPhone(n.phone) : n.phone;
  const name = x.caller_name ?? "Unknown caller";

  if (n.status === "complaint") {
    const text = [
      `URGENT · COMPLAINT · existing client`,
      `${name} · ${phone} · called ${when}`,
      `What happened: ${n.complaint?.summary ?? x.scope_text}`,
      n.complaint?.wantsSenior ? `Wants callback from: ${n.complaint.wantsSenior}` : `Wants a senior callback`,
      `Told: a senior will call back as soon as possible (no time promised)`,
      `Free times: ${n.callbackWindow ?? x.callback_window ?? "not given"}`,
    ].join("\n");
    return { text, buttons: n.transcriptUrl ? [[{ text: "Transcript", url: n.transcriptUrl }]] : [] };
  }

  const type = x.project_type === "commercial" ? "Commercial" : "Residential";

  if (n.status === "callback") {
    const text = [
      `CALLBACK NEEDED · ${type} · helpdesk`,
      `${name} · ${phone} · called ${when}`,
      `Free times: ${n.callbackWindow ?? x.callback_window ?? "not given — try office hours"} · told "as soon as possible"`,
      `What we know: ${[x.scope_text, x.configuration, x.locality].filter(Boolean).join(" · ") || "very little"}`,
      `Missing: ${n.missing?.length ? n.missing.join(", ") : "—"}`,
      `Asked about price: ${x.asked_about_price ? "yes" : "no"}`,
      `After the call, set the deal to: New qualified · Service review · Admin review · Declined`,
    ].join("\n");
    return {
      text,
      buttons: [
        [
          { text: "✅ Qualified", data: `apr:${n.leadId}` },
          { text: "🎨 Designer review", data: `dsg:${n.leadId}` },
        ],
        [
          { text: "🗂 Admin review", data: `adm:${n.leadId}` },
          { text: "❌ Decline", data: `rej:${n.leadId}` },
        ],
        ...(n.dealUrl ? [[{ text: "Open in HubSpot", url: n.dealUrl }]] : []),
      ],
    };
  }
  const site = [x.configuration ?? (x.category !== "unknown" ? x.category : null), x.locality, x.pin].filter(Boolean).join(", ") || "not given";
  const area = x.carpet_sqft ? `${x.carpet_sqft.toLocaleString("en-IN")} sq ft carpet` : "area not given";
  const decision =
    x.decision_maker === "self"
      ? "Caller decides"
      : x.decision_maker === "authorised"
        ? "Authorised by owner"
        : x.decision_maker === "on_behalf_unconfirmed"
          ? `⚠ Not the decider — ${x.decision_maker_note ?? "calling on someone's behalf"}`
          : "⚠ Not established";
  const budget = x.budget_inr ? `${inr(x.budget_inr)}${x.budget_confirmed ? " (confirmed)" : " (unconfirmed)"}` : "not given";
  const watch = [
    ...(n.repeatCaller ? ["Repeat caller"] : []),
    ...(x.frustrated ? ["Caller frustrated"] : []),
    ...(n.flags.includes("area_unclear") ? [`Area unclear (${n.inArea})`] : []),
    ...(n.flags.includes("site_available_late") ? ["Site available late"] : []),
    ...(n.flags.includes("commercial_below_min") ? ["Below commercial minimum"] : []),
    ...(n.missing?.length ? [`Not captured on the call: ${n.missing.join(", ")}`] : []),
    ...x.watch_for,
    ...(n.summary ? [n.summary] : []),
  ];

  const text = [
    `NEW LEAD · ${type} · ${n.status === "qualified" ? "Qualified" : "Review"}`,
    `${name} · ${phone} · called ${when}`,
    `Site: ${site} · ${area}`,
    `Scope: ${x.scope_text || "not described"}`,
    `Timeline: ${x.timeline_text ?? "not given"}`,
    `Decision: ${decision}`,
    `Budget: ${budget}${n.budgetFlag === "tight" ? " · ⚠ budget tight" : ""}`,
    `Asked about price: ${x.asked_about_price ? "yes" : "no"}`,
    `Booked: ${n.booking ? `${n.booking.label}${n.booking.designer ? ` with ${n.booking.designer}` : ""}` : n.status === "review" ? "awaiting review" : "not yet"}`,
    ...(n.dealHealth ? [`Deal health: ${n.dealHealth.score}/100 · ${n.dealHealth.band[0].toUpperCase()}${n.dealHealth.band.slice(1)} (est.)`] : []),
    `Watch for: ${watch.length ? [...new Set(watch)].join("; ") : "—"}`,
  ].join("\n");

  const buttons: { text: string; data?: string; url?: string }[][] = [];
  if (n.status === "review") {
    buttons.push([
      { text: "✅ Approve", data: `apr:${n.leadId}` },
      { text: "❌ Reject", data: `rej:${n.leadId}` },
    ]);
    buttons.push([{ text: "🗂 Needs admin review", data: `adm:${n.leadId}` }]);
  }
  const links = [
    ...(n.dealUrl ? [{ text: "Open in HubSpot", url: n.dealUrl }] : []),
    ...(n.transcriptUrl ? [{ text: "Transcript", url: n.transcriptUrl }] : []),
  ];
  if (links.length) buttons.push(links);
  return { text, buttons };
}
