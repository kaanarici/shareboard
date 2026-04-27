type RateWindow = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  ok: boolean;
  retryAfterSeconds: number;
};

// Global rate limiter shape: `share:203.0.113.4 -> { count: 2, resetAt: 1710000000000 }`.
// Pinned to globalThis so HMR / module reloads in dev don't clear in-flight windows.
const store = globalThis.__shareboardRateLimitStore ?? new Map<string, RateWindow>();
globalThis.__shareboardRateLimitStore = store;

declare global {
  var __shareboardRateLimitStore: Map<string, RateWindow> | undefined;
}

// Sweep expired windows once per ~256 calls so the map can't grow unbounded
// across long-lived processes (local node dev, Worker isolates with sticky
// global state). Cheap and bounded — only iterates the live entries.
const PRUNE_EVERY = 256;
let callsSinceLastPrune = 0;

function pruneExpired(now: number) {
  for (const [key, window] of store) {
    if (window.resetAt <= now) store.delete(key);
  }
}

export function takeRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  if (++callsSinceLastPrune >= PRUNE_EVERY) {
    callsSinceLastPrune = 0;
    pruneExpired(now);
  }

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
