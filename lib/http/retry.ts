/**
 * fetch with retries for outbound integration calls: retries network errors,
 * 429 and 5xx with exponential backoff + jitter, honouring Retry-After.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  opts: { retries?: number; baseMs?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const retries = opts.retries ?? 3;
  const base = opts.baseMs ?? 300;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
      if (res.status !== 429 && res.status < 500) return res;
      if (attempt === retries) return res;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(base, attempt));
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw err;
      await sleep(backoff(base, attempt));
    }
  }
  throw lastErr;
}

function backoff(base: number, attempt: number) {
  return base * 2 ** attempt + Math.random() * base;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
