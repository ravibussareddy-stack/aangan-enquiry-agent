/** KPI tile: value, change vs the previous period (coloured by whether it's good), and target status. */

/** Rupees as the founder reads them: ₹ lakh / crore. */
export function money(inr: number | null | undefined): string {
  if (inr == null) return "—";
  if (inr >= 1e7) return `₹${(inr / 1e7).toFixed(inr >= 1e8 ? 1 : 2)} Cr`;
  if (inr >= 1e5) return `₹${(inr / 1e5).toFixed(inr >= 1e6 ? 1 : 2)} L`;
  return `₹${Math.round(inr).toLocaleString("en-IN")}`;
}

export function Kpi({
  label,
  value,
  change,
  lowerIsBetter = false,
  vs,
  why,
  target,
  targetText,
}: {
  label: string;
  value: string;
  change: { now: number | null; before: number | null };
  lowerIsBetter?: boolean;
  vs: string;
  why: string;
  target?: "ok" | "warn" | null;
  targetText?: string;
}) {
  const { now, before } = change;
  let delta: { text: string; cls: "up" | "down" | "flat" } | null = null;
  if (now != null && before != null) {
    if (before === 0 && now === 0) delta = { text: "no change", cls: "flat" };
    else if (before === 0) delta = { text: "new", cls: lowerIsBetter ? "flat" : "up" };
    else {
      const pctChange = ((now - before) / Math.abs(before)) * 100;
      const better = lowerIsBetter ? pctChange < 0 : pctChange > 0;
      delta = Math.abs(pctChange) < 1 ? { text: "no change", cls: "flat" } : { text: `${pctChange > 0 ? "▲" : "▼"} ${Math.abs(Math.round(pctChange))}%`, cls: better ? "up" : "down" };
    }
  }
  return (
    <div className="tile kpi">
      <div className="label">
        <span>{label}</span>
        {delta && <span className={`delta ${delta.cls}`} title={vs}>{delta.text}</span>}
      </div>
      <div className="value">{value}</div>
      {targetText && <div className={`target ${target ?? ""}`}>{target === "ok" ? "✓ " : target === "warn" ? "! " : ""}{targetText}</div>}
      <div className="why">{why}</div>
    </div>
  );
}
