import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, hasAccess } from "@/lib/auth/viewer";
import { Nav, SignOutIcon } from "./_components/nav";

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
            You&apos;re signed in as {viewer.email}, but this account hasn&apos;t been given a founder or designer role. Ask the founder to add your
            email to DESIGNER_EMAILS.
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
        <Link href="/dashboard" className="logo" aria-label="Aangan Studio" title="Aangan Studio">
          A
        </Link>
        <Nav founder={viewer.role === "founder"} />
        <div className="spacer" />
        <Link href="/api/auth/sign-out" title="Sign out" aria-label="Sign out">
          <SignOutIcon />
        </Link>
        <span className="avatar" title={`${who} · ${viewer.role}`}>
          {who.slice(0, 1).toUpperCase()}
        </span>
      </aside>
      <div className="shell">{children}</div>
    </div>
  );
}
