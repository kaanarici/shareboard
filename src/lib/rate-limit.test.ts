import { afterEach, describe, expect, test } from "bun:test";
import {
  RATE_LIMIT_BINDINGS,
  resetRateLimitForTesting,
  setRateLimitEnvForTesting,
  takeRateLimit,
} from "./rate-limit";

afterEach(() => {
  resetRateLimitForTesting();
});

describe("takeRateLimit", () => {
  test("falls back to the in-memory limiter when no Cloudflare binding is present", async () => {
    setRateLimitEnvForTesting({});

    const first = await takeRateLimit("fallback:203.0.113.10", 1, 60_000, {
      binding: RATE_LIMIT_BINDINGS.shareCreate,
    });
    const second = await takeRateLimit("fallback:203.0.113.10", 1, 60_000, {
      binding: RATE_LIMIT_BINDINGS.shareCreate,
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });

  test("requires both the Cloudflare binding and in-memory limiter to allow", async () => {
    const calls: string[] = [];
    setRateLimitEnvForTesting({
      [RATE_LIMIT_BINDINGS.og]: {
        async limit({ key }) {
          calls.push(key);
          return { success: key !== "og:blocked-by-binding" };
        },
      },
    });

    const bindingDenied = await takeRateLimit("og:blocked-by-binding", 10, 60_000, {
      binding: RATE_LIMIT_BINDINGS.og,
    });
    const firstLocal = await takeRateLimit("og:blocked-by-map", 1, 60_000, {
      binding: RATE_LIMIT_BINDINGS.og,
    });
    const localDenied = await takeRateLimit("og:blocked-by-map", 1, 60_000, {
      binding: RATE_LIMIT_BINDINGS.og,
    });

    expect(bindingDenied.ok).toBe(false);
    expect(bindingDenied.retryAfterSeconds).toBe(60);
    expect(firstLocal.ok).toBe(true);
    expect(localDenied.ok).toBe(false);
    expect(calls).toEqual([
      "og:blocked-by-binding",
      "og:blocked-by-map",
      "og:blocked-by-map",
    ]);
  });
});
