const IST_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hourCycle: "h23" });
const IST_DATE = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });

export function greetingFor(now: Date) {
  const h = Number(IST_HOUR.format(now));
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function firstName(nameOrEmail: string) {
  const raw = (nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail).trim().split(/[\s._-]+/)[0];
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Page header: time-of-day greeting (IST), today's date, and optional controls on the right. */
export function Greeting({ name, sub, children }: { name: string; sub: string; children?: React.ReactNode }) {
  const now = new Date();
  return (
    <header className="pagehead">
      <div>
        <h1>
          {greetingFor(now)}, {firstName(name)}
        </h1>
        <div className="sub">
          {IST_DATE.format(now)} · {sub}
        </div>
      </div>
      {children && <div className="row">{children}</div>}
    </header>
  );
}
