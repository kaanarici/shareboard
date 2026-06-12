type RateWindow = {
  count: number;
  resetAt: number;
};

type RateLimitResult = {
  ok: boolean;
  retryAfterSeconds: number;
};

type CloudflareRateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

export const RATE_LIMIT_BINDINGS = {
  shareCreate: "SHAREBOARD_SHARE_CREATE_RATE_LIMIT",
  shareDelete: "SHAREBOARD_SHARE_DELETE_RATE_LIMIT",
  unlock: "SHAREBOARD_UNLOCK_RATE_LIMIT",
  og: "SHAREBOARD_OG_RATE_LIMIT",
} as const;

type RateLimitBindingName =
  (typeof RATE_LIMIT_BINDINGS)[keyof typeof RATE_LIMIT_BINDINGS];
type RateLimitEnv = Partial<Record<RateLimitBindingName, CloudflareRateLimitBinding>>;
type RateLimitOptions = {
  binding?: RateLimitBindingName;
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
const BINDING_RETRY_SECONDS: Record<RateLimitBindingName, number> = {
  [RATE_LIMIT_BINDINGS.shareCreate]: 60,
  [RATE_LIMIT_BINDINGS.shareDelete]: 60,
  [RATE_LIMIT_BINDINGS.unlock]: 60,
  [RATE_LIMIT_BINDINGS.og]: 60,
};
const PRUNE_EVERY = 256;
let callsSinceLastPrune = 0;
let cloudflareEnvPromise: Promise<RateLimitEnv> | undefined;
let cloudflareEnvForTesting: RateLimitEnv | undefined;
let hasCloudflareEnvForTesting = false;

function getCloudflareEnv(): Promise<RateLimitEnv> {
  if (hasCloudflareEnvForTesting) return Promise.resolve(cloudflareEnvForTesting ?? {});
  cloudflareEnvPromise ??= (async () => {
    try {
      return ((await import(/* @vite-ignore */ "cloudflare:workers")).env ?? {}) as RateLimitEnv;
    } catch {
      return {};
    }
  })();
  return cloudflareEnvPromise;
}

function pruneExpired(now: number) {
  for (const [key, window] of store) {
    if (window.resetAt <= now) store.delete(key);
  }
}

function takeLocalRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
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

async function takeCloudflareRateLimit(
  key: string,
  bindingName: RateLimitBindingName | undefined,
): Promise<RateLimitResult> {
  if (!bindingName) return { ok: true, retryAfterSeconds: 0 };
  const binding = (await getCloudflareEnv())[bindingName];
  if (!binding?.limit) return { ok: true, retryAfterSeconds: 0 };

  // Cloudflare rate limits are per-colo/eventually consistent: useful abuse
  // damping, not accounting. The Map above remains the precise local window.
  const result = await binding.limit({ key });
  return {
    ok: result.success,
    retryAfterSeconds: result.success ? 0 : BINDING_RETRY_SECONDS[bindingName],
  };
}

export async function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const local = takeLocalRateLimit(key, limit, windowMs);
  const cloudflare = await takeCloudflareRateLimit(key, options.binding);
  const retryAfterSeconds = Math.max(local.ok ? 0 : local.retryAfterSeconds, cloudflare.retryAfterSeconds);

  return {
    ok: local.ok && cloudflare.ok,
    retryAfterSeconds: retryAfterSeconds || local.retryAfterSeconds,
  };
}

export function setRateLimitEnvForTesting(env: RateLimitEnv | undefined) {
  cloudflareEnvForTesting = env;
  hasCloudflareEnvForTesting = env !== undefined;
  cloudflareEnvPromise = undefined;
}

export function resetRateLimitForTesting() {
  store.clear();
  callsSinceLastPrune = 0;
  setRateLimitEnvForTesting(undefined);
}
