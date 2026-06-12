import { describe, expect, test } from "bun:test";
import { resolveShareIntake } from "./share-intake";

describe("resolveShareIntake", () => {
  test("prefers a valid explicit url param", () => {
    expect(
      resolveShareIntake({ title: "Example", text: "Check this", url: "https://example.com" }),
    ).toEqual({ kind: "url", url: "https://example.com" });
  });

  test("falls back to the first http(s) url inside text", () => {
    expect(
      resolveShareIntake({ title: "Look", text: "great read https://blog.dev/post?x=1 enjoy" }),
    ).toEqual({ kind: "url", url: "https://blog.dev/post?x=1" });
  });

  test("ignores an invalid url param and uses a url from text", () => {
    expect(
      resolveShareIntake({ url: "not-a-url", text: "see http://x.io here" }),
    ).toEqual({ kind: "url", url: "http://x.io" });
  });

  test("makes a note from text when no url is present", () => {
    expect(resolveShareIntake({ title: "Idea", text: "just a thought" })).toEqual({
      kind: "note",
      text: "just a thought",
    });
  });

  test("falls back to title when only a title is shared", () => {
    expect(resolveShareIntake({ title: "Idea" })).toEqual({ kind: "note", text: "Idea" });
  });

  test("rejects non-http(s) schemes", () => {
    expect(resolveShareIntake({ url: "javascript:alert(1)", title: "x" })).toEqual({
      kind: "note",
      text: "x",
    });
  });

  test("returns null when nothing usable is shared", () => {
    expect(resolveShareIntake({})).toBeNull();
  });
});
