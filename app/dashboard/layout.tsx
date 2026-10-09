import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, hasAccess, homeFor } from "@/lib/auth/viewer";
import { Nav, SignOutIcon } from "./_components/nav";
import { WindChime } from "./_components/wind-chime";

// Every dashboard page reads the session and live data, so it renders on the server per request.
export const instant = false;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/sign-in");
  if (!hasAccess(viewer)) {
    return (
      <main className="auth">
        <div className="card" style={{ maxWidth: 520 }}>
          <h1>No access yet</h1>
          <p className="muted">
            You&apos;re signed in as {viewer.email}, but this account hasn&apos;t been given a founder or designer role. Ask the founder to add your email to
            DESIGNER_EMAILS.
          </p>
          <Link href="/api/auth/sign-out">Sign out</Link>
        </div>
      </main>
    );
  }
  const who = viewer.name ?? viewer.email;
  return (
    <div className="app">
      <aside className="rail">
        <Link href={homeFor(viewer)} className="logo has-tip" aria-label="Aangan Studio" data-label="Aangan Studio" data-tip="Back to your home page">
          A
        </Link>
        <Nav role={viewer.role} />
        <div className="spacer" />
        <Link href="/api/auth/sign-out" className="has-tip" aria-label="Sign out" data-label="Sign out" data-tip="Leave the dashboard on this device">
          <SignOutIcon />
        </Link>
        <span className="avatar has-tip" tabIndex={0} data-label={who} data-tip={`Signed in as ${viewer.role === "frontdesk" ? "front desk" : viewer.role}`}>
          {who.slice(0, 1).toUpperCase()}
        </span>
      </aside>
      <div className="shell">{children}</div>
      {/* In the layout, not a page: it stays mounted (and playable) while pages switch and load. */}
      <WindChime />
    </div>
  );
}
