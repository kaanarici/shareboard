import { describe, expect, test } from "bun:test";
import {
  collectStoredImageObjectKeys,
  computeReplaceCleanupKeys,
  getPublicReplaceState,
  indexStoredCanvasImages,
} from "./share-storage";

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

  test("indexes images by id and keeps latest duplicate id", () => {
    const canvas = {
      id: "board-1",
      author: "A",
      pages: [
        {
          id: "p1",
          items: [
            { id: "img-1", type: "image", url: "https://x/1", objectKey: "images/a", size: 1 },
            { id: "n1", type: "note", text: "note" },
          ],
        },
        {
          id: "p2",
          items: [{ id: "img-1", type: "image", url: "https://x/2", objectKey: "images/b", size: 2 }],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    } as const;

    const map = indexStoredCanvasImages(canvas);
    expect(map.size).toBe(1);
    expect(map.get("img-1")?.objectKey).toBe("images/b");
  });

  test("collects only defined image object keys from pages", () => {
    const pages = [
      {
        id: "p1",
        items: [
          { id: "img-1", type: "image", url: "https://x/1", objectKey: "images/a" },
          { id: "img-2", type: "image", url: "https://x/2" },
          { id: "n1", type: "note", text: "note" },
        ],
      },
      {
        id: "p2",
        items: [{ id: "img-3", type: "image", url: "https://x/3", objectKey: "images/a" }],
      },
    ] as const;

    expect(Array.from(collectStoredImageObjectKeys(pages))).toEqual(["images/a"]);
  });

  test("builds public replace state from prior manifest", () => {
    const canvas = {
      id: "board-1",
      author: "A",
      previewUrl: "https://x/preview.png",
      pages: [
        {
          id: "p1",
          items: [
            { id: "img-1", type: "image", url: "https://x/1", objectKey: "images/a", size: 1 },
            { id: "img-2", type: "image", url: "https://x/2" },
          ],
        },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    } as const;

    const state = getPublicReplaceState(canvas);
    expect(state.priorPreviewUrl).toBe("https://x/preview.png");
    expect(state.reuseImagesById.size).toBe(2);
    expect(state.priorImageKeys).toEqual(["images/a"]);
  });
});
