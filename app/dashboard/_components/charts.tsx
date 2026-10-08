/**
 * Small server-rendered charts. Single-series only (one validated blue from the
 * reference palette), thin marks with 4px rounded data ends, native hover titles,
 * and a table view for every chart.
 */

export function TableView({ rows, headers }: { rows: (string | number)[][]; headers: string[] }) {
  return (
    <details className="table-view">
      <summary>Table view</summary>
      <table>
        <thead>
          <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className="num">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

export function BarList({ data, format = (n) => String(n), empty = "No data in this period." }: { data: { label: string; value: number }[]; format?: (n: number) => string; empty?: string }) {
  if (!data.length) return <p className="muted small">{empty}</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <>
      <div className="barlist">
        {data.map((d) => (
          <div className="barrow" key={d.label} title={`${d.label}: ${format(d.value)}`}>
            <span className="lbl">{d.label}</span>
            <span className="track">
              <span className="fill" style={{ display: "block", width: `${Math.max(2, (d.value / max) * 100)}%` }} />
            </span>
            <span className="num">{format(d.value)}</span>
          </div>
        ))}
      </div>
      <TableView headers={["", "Value"]} rows={data.map((d) => [d.label, format(d.value)])} />
    </>
  );
}

/** Columns over days (bookings by day). */
export function DayColumns({ data, from, to }: { data: { day: string; n: number }[]; from: Date; to: Date }) {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
  const days: string[] = [];
  for (let t = from.getTime(); fmt.format(new Date(t)) <= fmt.format(to); t += 86_400_000) days.push(fmt.format(new Date(t)));
  const byDay = new Map(data.map((d) => [d.day, d.n]));
  const values = days.map((d) => byDay.get(d) ?? 0);
  const max = Math.max(...values, 1);
  const W = 600, H = 140, pad = 22, gap = 2;
  const colW = (W - pad) / Math.max(days.length, 1) - gap;
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label="Bookings by day">
        {ticks.map((t) => {
          const y = H - (t / max) * (H - 10);
          return (
            <g key={t}>
              <line className="grid-line" x1={pad} x2={W} y1={y} y2={y} />
              <text className="axis" x={0} y={y + 3}>{t}</text>
            </g>
          );
        })}
        {values.map((v, i) => {
          const h = (v / max) * (H - 10);
          const x = pad + i * (colW + gap);
          return v > 0 ? (
            <rect key={days[i]} className="col" x={x} y={H - h} width={Math.max(colW, 1)} height={h} rx={Math.min(4, colW / 2)}>
              <title>{`${days[i]}: ${v} booking${v === 1 ? "" : "s"}`}</title>
            </rect>
          ) : null;
        })}
        <text className="axis" x={pad} y={H + 14}>{days[0]?.slice(5)}</text>
        <text className="axis" x={W} y={H + 14} textAnchor="end">{days.at(-1)?.slice(5)}</text>
      </svg>
      <TableView headers={["Day", "Bookings"]} rows={days.map((d, i) => [d, values[i]]).filter((r) => (r[1] as number) > 0)} />
    </div>
  );
}

/** Ordinal funnel: one hue, bar width = count, conversion from the previous step. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const max = Math.max(steps[0]?.value ?? 0, 1);
  return (
    <>
      <div className="funnel">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].value : null;
          const conv = prev ? `${Math.round((s.value / prev) * 100)}%` : "";
          return (
            <div className="funnel-row" key={s.label} title={`${s.label}: ${s.value}${conv ? ` (${conv} of previous step)` : ""}`}>
              <span className="muted">{s.label}</span>
              <span className="funnel-bar" style={{ width: `${(s.value / max) * 100}%`, opacity: 1 - i * 0.13 }} />
              <span className="num">
                {s.value} <span className="muted small">{conv}</span>
              </span>
            </div>
          );
        })}
      </div>
      <TableView headers={["Step", "Count", "From previous"]} rows={steps.map((s, i) => [s.label, s.value, i && steps[i - 1].value ? `${Math.round((s.value / steps[i - 1].value) * 100)}%` : "—"])} />
    </>
  );
}

export function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

/** Soft pill columns: bookings bucketed by day / week / fortnight, peak bucket highlighted. */
export function PillColumns({ data, from, to, bucketDays }: { data: { day: string; n: number }[]; from: Date; to: Date; bucketDays: number }) {
  const byDay = new Map(data.map((d) => [d.day, d.n]));
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });
  const short = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...(bucketDays === 1 ? { weekday: "short" } : { day: "numeric", month: "short" }) });
  const buckets: { start: Date; n: number }[] = [];
  // Buckets end at `to`, so the latest bucket is always a full one.
  for (let end = to.getTime(); end > from.getTime(); end -= bucketDays * 86_400_000) {
    const start = Math.max(from.getTime(), end - bucketDays * 86_400_000);
    let n = 0;
    for (let t = start + 1; t <= end; t += 86_400_000) n += byDay.get(ymd.format(new Date(t))) ?? 0;
    buckets.unshift({ start: new Date(start + 1), n });
  }
  const max = Math.max(...buckets.map((b) => b.n), 1);
  const peak = buckets.reduce((best, b, i) => (b.n > buckets[best].n ? i : best), 0);
  return (
    <>
      <div className="pillbars" role="img" aria-label="Bookings over time">
        {buckets.map((b, i) => {
          const isPeak = i === peak && b.n > 0;
          return (
            <div className={`pillbar${isPeak ? " peak" : ""}`} key={i} title={`${short.format(b.start)}: ${b.n} booking${b.n === 1 ? "" : "s"}`}>
              <div className="col" style={{ height: `${Math.max(12, (b.n / max) * 100)}%` }}>
                {isPeak && <span className="tip">{b.n}</span>}
              </div>
              <span className="x">{short.format(b.start)}</span>
            </div>
          );
        })}
      </div>
      <TableView headers={["From", "Bookings"]} rows={buckets.map((b) => [short.format(b.start), b.n])} />
    </>
  );
}
