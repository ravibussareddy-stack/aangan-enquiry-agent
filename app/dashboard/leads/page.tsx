import { freshFromCrm } from "@/lib/crm/stage-sync";
import Link from "next/link";
import { getViewer } from "@/lib/auth/viewer";
import { asUser } from "@/lib/db/as-user";
import { label, when } from "../_components/format";
import { Status } from "../_components/status";

// Live, per-request data (session + database).
export const instant = false;

interface Row {
  id: string;
  name: string | null;
  status: string;
  decline_reason: string | null;
  locality: string | null;
  scope_text: string | null;
  created_at: string;
  booked: string | null;
  designer: string | null;
  is_simulated: boolean;
  price_leak: boolean;
  deal_health_score: number | null;
  deal_health_band: string | null;
}

export default async function Leads({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const viewer = (await getViewer())!;
  await freshFromCrm(); // pick up stage changes made in HubSpot (throttled)
  const { status } = await searchParams;
  const { rows } = await asUser(viewer.userId, (c) =>
    c.query<Row>(
      `select l.id, l.name, l.status, l.decline_reason, l.locality, l.scope_text, l.created_at::text,
              b.slot_start::text booked, b.designer, c.is_simulated, c.price_leak, l.deal_health_score, l.deal_health_band
         from leads l join calls c on c.id = l.call_id
         left join bookings b on b.lead_id = l.id and b.status = 'booked'
        where ($1::text is null or l.status::text = $1)
        order by l.created_at desc limit 200`,
      [status ?? null],
    ),
  );
  const statuses = ["qualified", "review", "callback", "declined", "redirect", "complaint"];
  return (
    <main>
      <div className="filters">
        <h1 style={{ marginRight: "auto" }}>Leads</h1>
        <div className="seg" role="group" aria-label="Status">
          <Link href="?" aria-current={!status}>All</Link>
          {statuses.map((s) => (
            <Link key={s} href={`?status=${s}`} aria-current={status === s}>{label(s)}</Link>
          ))}
        </div>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Caller</th>
              <th>Status</th>
              <th>Health</th>
              <th>Scope</th>
              <th>Area</th>
              <th>Booking</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="num">{when(r.created_at)}</td>
                <td>
                  <Link href={`/dashboard/leads/${r.id}`}>{r.name ?? "Unknown"}</Link>
                  {r.is_simulated && <span className="badge" style={{ marginLeft: 6 }}>sim</span>}
                  {r.price_leak && <span className="badge declined" style={{ marginLeft: 6 }}>price leak</span>}
                </td>
                <td>
                  <Status status={r.status} />
                  {r.decline_reason && <div className="muted small">{label(r.decline_reason)}</div>}
                </td>
                <td className="num">{r.deal_health_score != null ? <span className={`badge health-${r.deal_health_band}`}>{r.deal_health_score}</span> : "—"}</td>
                <td className="small">{r.scope_text ?? "—"}</td>
                <td>{r.locality ?? "—"}</td>
                <td className="small">{r.booked ? `${when(r.booked)}${r.designer ? ` · ${r.designer}` : ""}` : "—"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="muted">No leads.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
