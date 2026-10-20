import { describe, expect, test } from "bun:test";
import { detectPlatform } from "./platforms";

describe("detectPlatform", () => {
  test("matches the hostname, not a path or query string", () => {
    expect(detectPlatform("https://x.com/shareboard")).toBe("twitter");
    expect(detectPlatform("https://example.com/twitter.com/status/1")).toBe("website");
    expect(detectPlatform("https://news.ycombinator.com/item?id=1&q=youtube.com")).toBe("website");
  });

  test("matches whole host labels, so lookalike domains stay plain links", () => {
    expect(detectPlatform("https://www.youtube.com/watch?v=abc")).toBe("youtube");
    expect(detectPlatform("https://m.facebook.com/page")).toBe("facebook");
    expect(detectPlatform("https://www.dropbox.com/s/file")).toBe("website");
    expect(detectPlatform("https://notreddit.com/")).toBe("website");
    expect(detectPlatform("https://sfb.com/")).toBe("website");
  });
});
