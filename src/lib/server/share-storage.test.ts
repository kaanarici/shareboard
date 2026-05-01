import { describe, expect, test } from "bun:test";
import { computeReplaceCleanupKeys } from "./share-storage";

describe("share storage replace cleanup", () => {
  test("returns only prior keys not in next set", () => {
    const prior = [
      "images/board/page/a",
      "images/board/page/b",
      "locked-images/keep",
      "images/board/page/a",
    ];
    const next = new Set(["images/board/page/b", "locked-images/keep"]);

    expect(computeReplaceCleanupKeys(prior, next)).toEqual([
      "images/board/page/a",
      "images/board/page/a",
    ]);
  });
});
