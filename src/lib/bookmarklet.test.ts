import { describe, expect, test } from "bun:test";
import { CLIP_HASH_PREFIX, buildBookmarklet, buildClipHash, parseClipHash } from "./bookmarklet";
import { resolveShareIntake } from "./share-intake";

describe("buildBookmarklet", () => {
  test("embeds the origin and keeps the capture in the fragment", () => {
    const code = buildBookmarklet("https://shareboard.app");
    expect(code.startsWith("javascript:")).toBe(true);
    expect(code).toContain('"https://shareboard.app/#clip="');
    // The capture must travel after the #, never as a query param.
    expect(code).not.toContain("?clip=");
  });
});

describe("parseClipHash", () => {
  test("round-trips a clip payload through the hash", () => {
    const hash = buildClipHash({ t: "Example", u: "https://example.com", x: "selected" });
    expect(hash.startsWith(CLIP_HASH_PREFIX)).toBe(true);
    expect(parseClipHash(hash)).toEqual({
      title: "Example",
      url: "https://example.com",
      text: "selected",
    });
  });

  test("survives reserved URL characters in the payload", () => {
    const hash = buildClipHash({ t: "A & B = C?", u: "https://x.com/p?q=1&r=2#frag" });
    expect(parseClipHash(hash)).toEqual({
      title: "A & B = C?",
      url: "https://x.com/p?q=1&r=2#frag",
      text: undefined,
    });
  });

  test("clamps each field to the length cap", () => {
    const long = "a".repeat(5000);
    const parsed = parseClipHash(buildClipHash({ t: long, x: long }));
    expect(parsed?.title?.length).toBe(4000);
    expect(parsed?.text?.length).toBe(4000);
  });

  test("returns null for a non-clip, empty, or contentless hash", () => {
    expect(parseClipHash("#page=2")).toBeNull();
    expect(parseClipHash("")).toBeNull();
    expect(parseClipHash(CLIP_HASH_PREFIX)).toBeNull();
    expect(parseClipHash(buildClipHash({}))).toBeNull();
  });

  test("returns null for malformed payloads", () => {
    expect(parseClipHash(CLIP_HASH_PREFIX + "not-json")).toBeNull();
    expect(parseClipHash(CLIP_HASH_PREFIX + "%")).toBeNull();
  });
});

describe("clip hash → share intake", () => {
  test("a title+url capture becomes a URL card", () => {
    const hash = buildClipHash({ t: "Example", u: "https://example.com" });
    expect(resolveShareIntake(parseClipHash(hash)!)).toEqual({
      kind: "url",
      url: "https://example.com",
    });
  });

  test("a title+selection capture becomes a note", () => {
    const hash = buildClipHash({ t: "Idea", x: "selected words" });
    expect(resolveShareIntake(parseClipHash(hash)!)).toEqual({
      kind: "note",
      text: "selected words",
    });
  });
});
