import { describe, expect, test } from "bun:test";
import { clampPageIndex, validatePageSearch } from "./pagination";

describe("page search", () => {
  test("validates 1-based ?page= and clamps 0-based indexes", () => {
    expect(validatePageSearch({ page: "2" })).toEqual({ page: 2 });
    expect(validatePageSearch({ page: 0 })).toEqual({});
    expect(validatePageSearch({ page: "nope" })).toEqual({});
    expect(validatePageSearch(undefined)).toEqual({});
    expect(clampPageIndex(4, 3)).toBe(2);
    expect(clampPageIndex(-1, 3)).toBe(0);
    expect(clampPageIndex(Number.NaN, 3)).toBe(0);
  });
});
