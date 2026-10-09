/** Shown instantly on navigation while a dashboard page renders on the server. */
export default function Loading() {
  return (
    <main aria-busy="true" aria-label="Loading">
      <div className="card skeleton" style={{ height: 64, marginBottom: 18, maxWidth: 420 }} />
      <div className="card skeleton" style={{ height: 150, marginBottom: 18 }} />
      <div className="grid">
        <div className="card skeleton span-7" style={{ height: 320 }} />
        <div className="card skeleton span-5" style={{ height: 320 }} />
      </div>
    </main>
  );
}
