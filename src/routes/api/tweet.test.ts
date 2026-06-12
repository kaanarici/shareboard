import { afterEach, describe, expect, test } from "bun:test";
import { resetRateLimitForTesting } from "@/lib/rate-limit";
import type { Tweet as TweetData } from "react-tweet/api";
import { createTweetResponse, Route } from "./tweet";

const TWEET_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";

const tweet = {
  __typename: "Tweet",
  id_str: "1234567890",
  text: "hello",
} as TweetData;

afterEach(() => {
  resetRateLimitForTesting();
});

async function getTweetRoute(id: string | null) {
  const handler = Route.options.server.handlers.GET;
  const url = id === null ? "http://local.test/api/tweet" : `http://local.test/api/tweet?id=${id}`;
  return handler({
    request: new Request(url),
  } as Parameters<typeof handler>[0]);
}

describe("tweet route", () => {
  test("rejects missing and non-numeric tweet ids", async () => {
    expect((await getTweetRoute(null)).status).toBe(400);
    expect((await getTweetRoute("abc123")).status).toBe(400);
  });

  test("returns the react-tweet data envelope for a found tweet", async () => {
    const response = await createTweetResponse("1234567890", async () => tweet);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(TWEET_CACHE_CONTROL);
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    // The route backfills the entity arrays the 2026 syndication API omits.
    expect(await response.json()).toEqual({
      data: { ...tweet, entities: { hashtags: [], symbols: [], user_mentions: [], urls: [] } },
    });
  });

  test("returns the react-tweet not-found envelope when the tweet is absent", async () => {
    const response = await createTweetResponse("1234567890", async () => null);

    expect(response.status).toBe(404);
    // A miss must never be cached — a transiently-unavailable tweet would
    // otherwise be pinned as "not found" for a day.
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: null });
  });
});
