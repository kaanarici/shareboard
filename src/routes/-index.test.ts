import { describe, expect, test } from "bun:test";
import { validateHomeSearch } from "./index";

describe("home search validation", () => {
  test("keeps primitive share-target params after TanStack JSON parsing", () => {
    expect(validateHomeSearch({ title: 2026, text: 1, url: true })).toEqual({
      title: "2026",
      text: "1",
      url: "true",
    });
  });

  test("rejects null, objects, and arrays for share-target params", () => {
    expect(validateHomeSearch({ title: null, text: ["x"], url: { href: "https://x.test" } })).toEqual({});
  });

  test("accepts shared worker and lost-file sentinel values", () => {
    expect(validateHomeSearch({ shared: 1 })).toEqual({ shared: "1" });
    expect(validateHomeSearch({ shared: "lost" })).toEqual({ shared: "lost" });
  });
});
