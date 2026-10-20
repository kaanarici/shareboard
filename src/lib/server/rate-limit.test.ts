import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseJson, isRecord } from "@/lib/json";
import { setServerEnvForTesting } from "./env";
import { RATE_LIMITS, resetRateLimitsForTesting, takeRateLimit } from "./rate-limit";

afterEach(() => {
  setServerEnvForTesting(undefined);
  resetRateLimitsForTesting();
});

function wranglerRateLimits() {
  const text = readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, "");
  const config = parseJson(text);
  if (!isRecord(config) || !Array.isArray(config.ratelimits)) throw new Error("wrangler.jsonc has no ratelimits");
  return config.ratelimits;
}

describe("rate limits", () => {
  test("every limit in code matches a wrangler binding exactly, and vice versa", () => {
    const fromWrangler = wranglerRateLimits()
      .map((entry) => {
        if (!isRecord(entry) || !isRecord(entry.simple)) throw new Error("unexpected ratelimit entry");
        return { binding: entry.name, namespace: entry.namespace_id, limit: entry.simple.limit, period: entry.simple.period };
      })
      .sort((a, b) => String(a.binding).localeCompare(String(b.binding)));
    const fromCode = Object.values(RATE_LIMITS)
      .map(({ binding, namespace, limit, period }) => ({ binding, namespace, limit, period }))
      .sort((a, b) => a.binding.localeCompare(b.binding));
    expect(fromWrangler).toEqual(fromCode);
  });

  test("periods are ones Cloudflare accepts", () => {
    for (const config of Object.values(RATE_LIMITS)) expect([10, 60]).toContain(config.period);
  });

  test("falls back to an in-memory window with the same limit when no binding exists", async () => {
    setServerEnvForTesting({});
    for (let i = 0; i < RATE_LIMITS.unlock.limit; i += 1) expect(await takeRateLimit("unlock", "ip")).toBe(true);
    expect(await takeRateLimit("unlock", "ip")).toBe(false);
    expect(await takeRateLimit("unlock", "other-ip")).toBe(true);
  });

  test("uses the Cloudflare binding when present, keyed by limit name and subject", async () => {
    const keys: string[] = [];
    setServerEnvForTesting({
      SHAREBOARD_OG_RATE_LIMIT: {
        async limit({ key }) {
          keys.push(key);
          return { success: key !== "og:blocked" };
        },
      },
    });
    expect(await takeRateLimit("og", "blocked")).toBe(false);
    expect(await takeRateLimit("og", "fine")).toBe(true);
    expect(keys).toEqual(["og:blocked", "og:fine"]);
  });
});
