export function Status({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status}</span>;
}
