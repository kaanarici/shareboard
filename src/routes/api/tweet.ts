import { createFileRoute } from "@tanstack/react-router";
import { getTweet } from "react-tweet/api";
import type { Tweet as TweetData } from "react-tweet/api";
import { rateLimitResponse } from "@/lib/server/rate-limit";
import { clientIp } from "@/lib/server/request";
import { jsonResponse } from "@/lib/server/http";

const TWEET_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";
const TWEET_ID_PATTERN = /^\d+$/;

const TWEET_FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
} as const;

type TweetPayload = { id_str: string; entities?: Partial<TweetData["entities"]> };
type TweetFetcher = (id: string) => Promise<TweetPayload | null | undefined>;

const fetchTweetWithBrowserUA: TweetFetcher = (id) =>
  getTweet(id, { headers: TWEET_FETCH_HEADERS, signal: AbortSignal.timeout(5000) });

function isTweetId(value: string | null): value is string {
  return value !== null && TWEET_ID_PATTERN.test(value);
}

function normalizeTweet<T extends TweetPayload>(tweet: T) {
  const entities = tweet.entities;
  return {
    ...tweet,
    entities: {
      hashtags: entities?.hashtags ?? [],
      symbols: entities?.symbols ?? [],
      user_mentions: entities?.user_mentions ?? [],
      urls: entities?.urls ?? [],
    },
  };
}

export async function createTweetResponse(id: string, fetchTweet: TweetFetcher = fetchTweetWithBrowserUA) {
  const tweet = await fetchTweet(id);
  if (!tweet) return jsonResponse({ data: null }, { status: 404 });
  return jsonResponse({ data: normalizeTweet(tweet) }, {}, TWEET_CACHE_CONTROL);
}

export async function handleTweetGet(request: Request, fetchTweet?: TweetFetcher): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  if (!isTweetId(id)) return jsonResponse({ error: "Invalid tweet id" }, { status: 400 });
  const limited = await rateLimitResponse("tweet", clientIp(request), "Too many tweet requests. Try again shortly.");
  if (limited) return limited;
  try {
    return await createTweetResponse(id, fetchTweet);
  } catch {
    return jsonResponse({ error: "Failed to fetch tweet" }, { status: 502 });
  }
}

export const Route = createFileRoute("/api/tweet")({
  server: {
    handlers: {
      GET: ({ request }) => handleTweetGet(request),
    },
  },
});
