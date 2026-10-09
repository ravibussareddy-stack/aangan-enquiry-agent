import { redirect } from "next/navigation";
import { getViewer, homeFor } from "@/lib/auth/viewer";
import { asUser } from "@/lib/db/as-user";
import { integrationStatus } from "@/lib/integrations/status";
import { crmSyncState } from "@/lib/crm/stage-sync";
import { addRate, saveConfig, syncHubSpotNow } from "../actions";
import { when } from "../_components/format";

// Live, per-request data (session + database).
export const instant = false;

interface ConfigRow {
  key: string;
  value: unknown;
  description: string | null;
  needs_founder_signoff: boolean;
  server_only: boolean;
  updated_at: string;
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/sign-in");
  if (viewer.role !== "founder") redirect(homeFor(viewer));
  const sp = await searchParams;
  const { config, rates } = await asUser(viewer.userId, async (c) => ({
    config: (await c.query<ConfigRow>("select key, value, description, needs_founder_signoff, server_only, updated_at::text from config order by key")).rows,
    rates: (await c.query<{ component: string; unit: string; unit_rate_inr: number; effective_from: string; note: string | null }>(
      "select component, unit, unit_rate_inr::float8 unit_rate_inr, effective_from::text, note from rates order by component, unit, effective_from desc",
    )).rows,
  }));

  const integrations = integrationStatus();
  const hubspotOn = integrations.some((i) => i.name === "HubSpot" && i.connected);
  const sync = hubspotOn ? await crmSyncState() : null;

  return (
    <main>
      <div className="filters">
        <h1>Settings</h1>
        <span className="muted small">Founder only · changes apply to the next call (cached ≤ 60 s)</span>
      </div>
      {sp.saved && <p className="notice">Saved {sp.saved}.</p>}
      {sp.error && <p className="error">{sp.error}</p>}

      <div className="grid">
        <section className="card span-12" aria-labelledby="int-h">
          <div className="card-head">
            <h2 id="int-h">Integrations</h2>
            <span className="muted small">set keys in Vercel → Environment Variables, then redeploy</span>
          </div>
          {hubspotOn && (
            <form action={syncHubSpotNow} className="notice row" style={{ marginBottom: 12, justifyContent: "space-between" }}>
              <span>
                <b>HubSpot ↔ dashboard sync.</b> Changes made here go to HubSpot straight away. Deal stage changes made in HubSpot are pulled in
                when the dashboard opens (at most once a minute) and by the background job.{" "}
                {sync?.last_ok_at ? `Last synced ${when(sync.last_ok_at)} · ${sync.last_checked} deals checked, ${sync.last_changes} change(s).` : "Not synced yet."}
                {sync?.last_error && <span className="error"> Last error: {sync.last_error}</span>}
              </span>
              <button className="btn primary" type="submit">Sync now</button>
            </form>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Service</th><th>Status</th><th>Without it</th><th>Keys</th></tr></thead>
              <tbody>
                {integrations.map((i) => (
                  <tr key={i.name}>
                    <td>{i.name}</td>
                    <td><span className={`badge ${i.connected ? "on" : "off"}`}>{i.connected ? "Connected" : "Not connected"}</span></td>
                    <td className="small muted">{i.connected ? "—" : i.fallback}</td>
                    <td className="small muted"><code>{i.needs}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {config.map((c) => (
          <form key={c.key} action={saveConfig} className="card span-6" style={{ display: "grid", gap: 8 }}>
            <div className="card-head" style={{ marginBottom: 0 }}>
              <h3>{c.key}</h3>
              <span className="row">
                {c.needs_founder_signoff && <span className="badge review">needs founder sign-off</span>}
                {c.server_only && <span className="badge">server only</span>}
              </span>
            </div>
            <p className="muted small" style={{ margin: 0 }}>{c.description}</p>
            <input type="hidden" name="key" value={c.key} />
            <textarea name="value" defaultValue={JSON.stringify(c.value, null, 2)} rows={Math.min(12, JSON.stringify(c.value, null, 2).split("\n").length + 1)} aria-label={`${c.key} value (JSON)`} />
            <div className="row">
              <button className="btn primary" type="submit">Save</button>
              <span className="muted small">updated {when(c.updated_at)}</span>
            </div>
          </form>
        ))}

        <section className="card span-12">
          <h2 style={{ marginBottom: 12 }}>Rates (₹)</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Component</th><th>Unit</th><th>Rate</th><th>Effective from</th><th>Note</th></tr></thead>
              <tbody>
                {rates.map((r, i) => (
                  <tr key={i}>
                    <td>{r.component}</td><td>{r.unit}</td><td className="num">{r.unit_rate_inr}</td>
                    <td className="num">{when(r.effective_from)}</td><td className="small muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={addRate} className="grid" style={{ marginTop: 16, gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
            <label>Component<input name="component" required placeholder="voice_minutes" /></label>
            <label>Unit<input name="unit" required placeholder="minute" /></label>
            <label>₹ per unit<input name="unit_rate_inr" type="number" step="0.0001" min="0" required /></label>
            <label>Effective from<input name="effective_from" type="date" required /></label>
            <label>Note<input name="note" /></label>
            <div style={{ alignSelf: "end" }}><button className="btn primary">Add rate</button></div>
          </form>
          <p className="muted small" style={{ marginTop: 8 }}>New rates apply from their date; past costs keep the rate in effect at the time.</p>
        </section>
      </div>
    </main>
  );
}
