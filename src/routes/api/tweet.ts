import { createFileRoute } from "@tanstack/react-router";
import { getTweet } from "react-tweet/api";
import type { Tweet as TweetData } from "react-tweet/api";
import { storedObjectHeaders } from "@/lib/r2";
import { takeRateLimit } from "@/lib/rate-limit";

const TWEET_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";
const TWEET_RATE_LIMIT = { count: 60, windowMs: 5 * 60 * 1000 };
const TWEET_ID_PATTERN = /^\d+$/;

// The syndication API blocks Cloudflare's default Worker egress UA (datacenter
// fingerprint), which surfaced as a 502 on every embed. A real browser UA +
// the headers the embed widget sends gets the same request through.
const TWEET_FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

type TweetFetcher = (id: string) => Promise<TweetData | null | undefined>;

const fetchTweetWithBrowserUA: TweetFetcher = (id) => getTweet(id, { headers: TWEET_FETCH_HEADERS });

export function isTweetId(value: string | null): value is string {
  return typeof value === "string" && TWEET_ID_PATTERN.test(value);
}

function tweetHeaders(headers: Record<string, string> = {}) {
  return storedObjectHeaders({
    "Cache-Control": TWEET_CACHE_CONTROL,
    ...headers,
  });
}

function errorHeaders(headers: Record<string, string> = {}) {
  return storedObjectHeaders({
    "Cache-Control": "no-store",
    ...headers,
  });
}

function getClientIp(request: Request): string | null {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip && ip.length > 0 ? ip : null;
}

// The 2026 syndication response ships `entities` with only `urls`; react-tweet's
// enrichment iterates hashtags/symbols/user_mentions and throws "entities is not
// iterable" when they're absent. Backfill the missing arrays so embeds render.
function normalizeTweet(tweet: TweetData): TweetData {
  const entities = (tweet as unknown as { entities?: Record<string, unknown> }).entities ?? {};
  return {
    ...tweet,
    entities: {
      hashtags: [],
      symbols: [],
      user_mentions: [],
      urls: [],
      ...entities,
    },
  } as TweetData;
}

export async function createTweetResponse(id: string, fetchTweet: TweetFetcher = fetchTweetWithBrowserUA) {
  const tweet = await fetchTweet(id);
  if (!tweet) {
    // Never cache a miss: a tweet can be transiently unavailable (rate limit,
    // egress hiccup), and caching the 404 would pin "View on X" for a day.
    return Response.json({ data: null }, { status: 404, headers: errorHeaders() });
  }
  return Response.json(
    { data: normalizeTweet(tweet) },
    {
      status: 200,
      headers: tweetHeaders(),
    }
  );
}

export const Route = createFileRoute("/api/tweet")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const id = new URL(request.url).searchParams.get("id");
        if (!isTweetId(id)) {
          return Response.json(
            { error: "Invalid tweet id" },
            { status: 400, headers: errorHeaders() }
          );
        }

        const ip = getClientIp(request);
        if (ip) {
          const rate = await takeRateLimit(
            `tweet:${ip}`,
            TWEET_RATE_LIMIT.count,
            TWEET_RATE_LIMIT.windowMs
          );
          if (!rate.ok) {
            return Response.json(
              { error: "Too many tweet requests. Try again shortly." },
              {
                status: 429,
                headers: errorHeaders({ "Retry-After": String(rate.retryAfterSeconds) }),
              }
            );
          }
        }

        try {
          return await createTweetResponse(id);
        } catch {
          return Response.json(
            { error: "Failed to fetch tweet" },
            { status: 502, headers: errorHeaders() }
          );
        }
      },
    },
  },
});
