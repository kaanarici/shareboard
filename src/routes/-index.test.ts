import { describe, expect, test } from "bun:test";
import { validateEditorSearch } from "./index";

describe("editor search validation", () => {
  test("keeps primitive share-target params after TanStack JSON parsing", () => {
    expect(validateEditorSearch({ title: 2026, text: 1, url: true })).toEqual({
      title: "2026",
      text: "1",
      url: "true",
    });
  });

  test("rejects null, objects, and arrays for share-target params", () => {
    expect(validateEditorSearch({ title: null, text: ["x"], url: { href: "https://x.test" } })).toEqual({});
  });

  test("accepts shared worker and lost-file sentinel values", () => {
    expect(validateEditorSearch({ shared: 1 })).toEqual({ shared: "1" });
    expect(validateEditorSearch({ shared: "lost" })).toEqual({ shared: "lost" });
  });
});
