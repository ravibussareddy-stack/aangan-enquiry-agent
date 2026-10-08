import { getViewer } from "@/lib/auth/viewer";
import { asUser } from "@/lib/db/as-user";
import { label, when } from "../_components/format";

// Live, per-request data (session + database).
export const instant = false;

interface Row {
  id: string;
  intent: string;
  caller_name: string | null;
  phone: string;
  for_person: string | null;
  designer: string | null;
  about: string;
  callback_window: string | null;
  delivered_to: string | null;
  created_at: string;
}

export default async function Messages() {
  const viewer = (await getViewer())!;
  const { rows } = await asUser(viewer.userId, (c) =>
    c.query<Row>(
      `select m.id, m.intent, m.caller_name, m.phone, m.for_person, d.name designer, m.about, m.callback_window, m.delivered_to, m.created_at::text
         from call_messages m left join designers d on d.id = m.for_designer_id
        order by m.created_at desc limit 200`,
    ),
  );
  return (
    <main>
      <div className="filters">
        <h1>Messages</h1>
        <span className="muted small">Calls that weren&apos;t new enquiries — an existing-project update, a named designer, or something else.</span>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>When</th><th>Caller</th><th>Type</th><th>For</th><th>About</th><th>Call back</th><th>Delivered</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="num">{when(r.created_at)}</td>
                <td>{r.caller_name ?? "—"}<div className="muted small num">{r.phone}</div></td>
                <td><span className="badge">{label(r.intent.replace("existing_project_", "project "))}</span></td>
                <td>{r.designer ?? r.for_person ?? "Helpdesk"}</td>
                <td className="small">{r.about}</td>
                <td className="small">{r.callback_window ?? "—"}</td>
                <td className="small muted">{r.delivered_to ? label(r.delivered_to) : "pending"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={7} className="muted">No messages.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
