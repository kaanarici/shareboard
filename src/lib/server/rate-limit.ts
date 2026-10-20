import { getServerEnv, type ServerEnv } from "@/lib/server/env";
import { jsonResponse } from "@/lib/server/http";

type RateLimitBinding = {
  [K in keyof ServerEnv]-?: K extends `${string}_RATE_LIMIT` ? K : never;
}[keyof ServerEnv];

export const RATE_LIMITS = {
  shareCreate: { binding: "SHAREBOARD_SHARE_CREATE_RATE_LIMIT", namespace: "1001", limit: 30, period: 60 },
  shareDelete: { binding: "SHAREBOARD_SHARE_DELETE_RATE_LIMIT", namespace: "1002", limit: 30, period: 60 },
  unlock: { binding: "SHAREBOARD_UNLOCK_RATE_LIMIT", namespace: "1003", limit: 2, period: 60 },
  og: { binding: "SHAREBOARD_OG_RATE_LIMIT", namespace: "1004", limit: 12, period: 60 },
  handoff: { binding: "SHAREBOARD_HANDOFF_RATE_LIMIT", namespace: "1005", limit: 4, period: 60 },
  tweet: { binding: "SHAREBOARD_TWEET_RATE_LIMIT", namespace: "1006", limit: 12, period: 60 },
  objects: { binding: "SHAREBOARD_OBJECTS_RATE_LIMIT", namespace: "1007", limit: 20, period: 60 },
  publicRead: { binding: "SHAREBOARD_PUBLIC_READ_RATE_LIMIT", namespace: "1009", limit: 60, period: 60 },
  unlockBoard: { binding: "SHAREBOARD_UNLOCK_BOARD_RATE_LIMIT", namespace: "1011", limit: 2, period: 60 },
  owner: { binding: "SHAREBOARD_OWNER_RATE_LIMIT", namespace: "1012", limit: 10, period: 60 },
} as const satisfies Record<string, { binding: RateLimitBinding; namespace: string; limit: number; period: 10 | 60 }>;

export type RateLimitName = keyof typeof RATE_LIMITS;

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

function takeInMemory(key: string, limit: number, periodMs: number): boolean {
  const now = Date.now();
  if (windows.size > 4096) {
    for (const [name, window] of windows) if (window.resetAt <= now) windows.delete(name);
  }
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + periodMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export async function takeRateLimit(name: RateLimitName, subject: string): Promise<boolean> {
  const config = RATE_LIMITS[name];
  const key = `${name}:${subject}`;
  const binding = (await getServerEnv())[config.binding];
  if (binding) return (await binding.limit({ key })).success;
  return takeInMemory(key, config.limit, config.period * 1000);
}

export async function rateLimitResponse(
  name: RateLimitName,
  subject: string,
  message: string,
  headers: HeadersInit = {},
): Promise<Response | null> {
  if (await takeRateLimit(name, subject)) return null;
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Retry-After", String(RATE_LIMITS[name].period));
  return jsonResponse({ error: message }, { status: 429, headers: responseHeaders });
}

export function resetRateLimitsForTesting() {
  windows.clear();
}
