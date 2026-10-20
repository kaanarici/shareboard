import { afterEach, describe, expect, test } from "bun:test";
import { resetRateLimitsForTesting } from "@/lib/server/rate-limit";
import { createTweetResponse, handleTweetGet } from "./tweet";

const TWEET_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400";

const tweet = {
  __typename: "Tweet",
  id_str: "1234567890",
  text: "hello",
};

afterEach(() => {
  resetRateLimitsForTesting();
});

async function getTweetRoute(id: string | null) {
  const url = id === null ? "http://local.test/api/tweet" : `http://local.test/api/tweet?id=${id}`;
  return handleTweetGet(new Request(url), async () => null);
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
    expect(await response.json()).toEqual({
      data: { ...tweet, entities: { hashtags: [], symbols: [], user_mentions: [], urls: [] } },
    });
  });

  test("returns the react-tweet not-found envelope when the tweet is absent", async () => {
    const response = await createTweetResponse("1234567890", async () => null);

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: null });
  });
});
