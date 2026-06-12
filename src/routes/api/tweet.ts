import { createFileRoute } from "@tanstack/react-router";
import { getTweet } from "react-tweet/api";
import type { Tweet as TweetData } from "react-tweet/api";
import { storedObjectHeaders } from "@/lib/r2";
import { takeRateLimit } from "@/lib/rate-limit";

const TWEET_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";
const TWEET_RATE_LIMIT = { count: 60, windowMs: 5 * 60 * 1000 };
const TWEET_ID_PATTERN = /^\d+$/;

type TweetFetcher = (id: string) => Promise<TweetData | null | undefined>;

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

export async function createTweetResponse(id: string, fetchTweet: TweetFetcher = getTweet) {
  const tweet = await fetchTweet(id);
  return Response.json(
    { data: tweet ?? null },
    {
      status: tweet ? 200 : 404,
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
