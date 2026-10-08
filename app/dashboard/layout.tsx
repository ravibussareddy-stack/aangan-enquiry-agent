import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer, hasAccess } from "@/lib/auth/viewer";
import { Nav } from "./_components/nav";

// Every dashboard page reads the session and live data, so it renders on the server per request.
export const instant = false;

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/auth/sign-in");
  if (!hasAccess(viewer)) {
    return (
      <main className="shell">
        <div className="card" style={{ maxWidth: 520, margin: "10vh auto" }}>
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
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <b>Aangan Studio</b>
          <span className="muted small">Phone enquiries</span>
        </div>
        <Nav founder={viewer.role === "founder"} />
        <span className="muted small">
          {viewer.name ?? viewer.email} · {viewer.role}
        </span>
      </header>
      {children}
    </div>
  );
}
