type RateWindow = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  ok: boolean;
  retryAfterSeconds: number;
};

// Global rate limiter shape: `share:203.0.113.4 -> { count: 2, resetAt: 1710000000000 }`.
const store = globalThis.__shareboardRateLimitStore ?? new Map<string, RateWindow>();
globalThis.__shareboardRateLimitStore = store;

declare global {
  var __shareboardRateLimitStore: Map<string, RateWindow> | undefined;
}

export function takeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const current = store.get(key);
  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  if (current.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  store.set(key, current);
  return {
    ok: true,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
  };
}
