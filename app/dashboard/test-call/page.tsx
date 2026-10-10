import { redirect } from "next/navigation";
import { quickTest } from "@/agent/prompt";
import { getViewer, homeFor } from "@/lib/auth/viewer";
import { loadRuntimeConfig } from "@/lib/config/runtime";
import { voiceSpendSoFar } from "@/lib/cost/spend-cap";
import { inr } from "../_components/format";
import { TestCall } from "./test-call";

// Live, per-request data (session + database).
export const instant = false;

export default async function TestCallPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/sign-in");
  if (viewer.role !== "founder") redirect(homeFor(viewer));
  const [spent, cfg] = await Promise.all([voiceSpendSoFar(), loadRuntimeConfig()]);
  const enabled = process.env.VOICE_PROVIDER === "vaani" && !!process.env.VAANI_AGENT_ID;
  const limitS = quickTest() ? 55 : cfg.voiceSpendCap.max_call_s;

  return (
    <main>
      <header className="pagehead">
        <div>
          <h1>Test call</h1>
          <div className="sub">Talk to the live agent from your browser — no phone number needed</div>
        </div>
      </header>
      <div className="grid">
        <section className="card span-7">
          {enabled ? (
            <TestCall limitS={limitS} />
          ) : (
            <p className="notice">
              Browser test calls are off here. They need <code>VOICE_PROVIDER=vaani</code> and <code>VAANI_AGENT_ID</code> — run this page on the
              local dashboard (<code>npm run dev</code>) with the brain and tunnel running.
            </p>
          )}
        </section>
        <section className="card span-5">
          <h2 style={{ marginBottom: 10 }}>Before you start</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
            <li>Spends real Vaani credit (billed per second): {inr(spent)} so far. There&apos;s no overall cap; each call is time-limited.</li>
            <li>{quickTest() ? "Quick-test mode: wrap-up from 40 s, goodbye at 55 s, Vaani cuts at 1 minute." : `The call ends after ${Math.round(limitS / 60)} minutes at most.`}</li>
            <li>The brain (<code>npm run brain</code>) and the Cloudflare tunnel must be running.</li>
            <li>Use headphones so the agent doesn&apos;t hear itself.</li>
            <li>Afterwards the call appears under Leads within a minute (transcript, outcome, cost).</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
