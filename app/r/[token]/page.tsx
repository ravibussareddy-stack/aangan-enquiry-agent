import type { Metadata } from "next";
import { connection } from "next/server";
import { db } from "@/lib/db/client";
import { verifyAction } from "@/lib/staff/links";
import { staffNameFor } from "@/lib/staff/recipients";
import { confirmStaffAction } from "./actions";

// Per-request: the token is checked against live lead state.
export const instant = false;

export const metadata: Metadata = { title: "Confirm action · Aangan", robots: { index: false, follow: false } };

const VERB: Record<string, { title: string; button: string }> = {
  apr: { title: "Approve this enquiry", button: "Approve and schedule the booking call" },
  rej: { title: "Decline this enquiry", button: "Decline (sends the polite SMS)" },
  dsg: { title: "Send to designer review", button: "Send to designers" },
  adm: { title: "Send to admin review", button: "Send to admin" },
};

export default async function ConfirmAction({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ msg?: string; ok?: string }> }) {
  await connection();
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const v = verifyAction(token);

  if (!v.ok) {
    return (
      <main className="auth">
        <div className="card auth-card">
          <h1>Link not usable</h1>
          <p className="muted">{v.reason}</p>
          <a className="pill ink" href="/dashboard/review">Open the review queue</a>
        </div>
      </main>
    );
  }

  const { a, l: leadId, r: email } = v.claim;
  const { rows } = await db().query<{ name: string | null; status: string; locality: string | null; scope_text: string | null }>(
    "select name, status::text, locality, scope_text from leads where id = $1",
    [leadId],
  );
  const lead = rows[0];
  const awaiting = lead && (lead.status === "review" || lead.status === "callback");

  return (
    <main className="auth">
      <form action={confirmStaffAction} className="card auth-card">
        <h1>{VERB[a].title}</h1>
        {lead ? (
          <dl className="kv">
            <dt>Caller</dt><dd>{lead.name ?? "Unknown"}</dd>
            <dt>Area</dt><dd>{lead.locality ?? "—"}</dd>
            <dt>Scope</dt><dd>{lead.scope_text ?? "—"}</dd>
            <dt>Status now</dt><dd>{lead.status}</dd>
          </dl>
        ) : (
          <p className="error">This lead no longer exists.</p>
        )}
        {sp.msg && <p className={sp.ok === "1" ? "notice" : "error"}>{sp.msg}</p>}
        <input type="hidden" name="token" value={token} />
        {lead && awaiting && !sp.msg && (
          <button className="pill ink" type="submit">{VERB[a].button}</button>
        )}
        {lead && !awaiting && !sp.msg && <p className="muted small">Already handled — it&apos;s no longer waiting for a decision.</p>}
        <p className="muted small">Signed in as {staffNameFor(email)} via your email link. <a href={`/dashboard/leads/${leadId}`}>Open the full lead</a></p>
      </form>
    </main>
  );
}
