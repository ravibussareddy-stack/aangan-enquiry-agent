/**
 * Short-lived, per-instance memo for expensive read-only dashboard queries
 * (KPI metrics, signals, latest insights). Moving between pages within the TTL
 * reuses the result instead of re-running a dozen queries; concurrent callers
 * share one in-flight promise. Failures are never cached.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();

export function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn().catch((err) => {
    store.delete(key);
    throw err;
  });
  store.set(key, { at: Date.now(), value });
  if (store.size > 200) store.delete(store.keys().next().value!); // bound memory
  return value;
}

/** Drop cached entries whose key starts with `prefix` (e.g. after an insights refresh). */
export function forget(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}
