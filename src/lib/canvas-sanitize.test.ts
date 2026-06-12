import { describe, expect, test } from "bun:test";
import {
  sanitizePublicCanvasManifest,
  sanitizeShareRequestPayload,
  sanitizeTinyCanvas,
} from "./canvas-sanitize";
import { isSafeObjectKey } from "./storage-keys";

describe("canvas sanitizers", () => {
  test("public manifests drop draft-only image state, generation, and legacy summary items", () => {
    const canvas = sanitizePublicCanvasManifest({
      id: "board",
      author: "Ada",
      createdAt: "2026-04-27T00:00:00.000Z",
      pages: [
        {
          id: "page",
          items: [
            {
              id: "draft-image",
              type: "image",
              previewUrl: "blob:http://localhost/draft",
              file: { name: "draft.png" },
            },
            { id: "__summary__", type: "board_summary" },
            { id: "note", type: "note", text: "hello" },
          ],
          layouts: {
            lg: [
              { i: "__summary__", x: 0, y: 0, w: 6, h: 4 },
              { i: "note", x: 6, y: 0, w: 6, h: 4 },
            ],
            sm: [{ i: "__summary__", x: 0, y: 0, w: 1, h: 4 }],
          },
        },
      ],
      generation: {
        item_summaries: [],
        overall_summary: { title: "Summary", explanation: "Text", tags: ["tag"] },
      },
    });

    expect(canvas?.pages[0]?.items).toEqual([{ id: "note", type: "note", text: "hello" }]);
    expect(canvas?.pages[0]?.layouts).toEqual({ lg: [{ i: "note", x: 6, y: 0, w: 6, h: 4 }], sm: [] });
    expect(canvas && "generation" in canvas).toBe(false);
  });

  test("public manifests keep safe local image proxy URLs and object keys", () => {
    const canvas = sanitizePublicCanvasManifest({
      id: "board",
      author: "Ada",
      createdAt: "2026-04-27T00:00:00.000Z",
      pages: [
        {
          id: "page",
          items: [
            {
              id: "image",
              type: "image",
              url: "/api/share?key=images%2Fboard%2Fpage%2Fimage",
              objectKey: "images/board/page/image",
            },
            {
              id: "bad",
              type: "image",
              url: "/api/share?key=canvases%2Fboard.json",
              objectKey: "../canvases/board.json",
            },
          ],
        },
      ],
    });

    expect(canvas?.pages[0]?.items).toEqual([
      {
        id: "image",
        type: "image",
        url: "/api/share?key=images%2Fboard%2Fpage%2Fimage",
        objectKey: "images/board/page/image",
      },
    ]);
  });

  test("tiny shares keep text, URL, and JSON items", () => {
    const canvas = sanitizeTinyCanvas({
      id: "tiny",
      author: "Ada",
      pages: [
        {
          id: "page",
          items: [
            { id: "url", type: "url", url: "https://example.com", platform: "website" },
            { id: "json", type: "json", name: "data.json", text: '{"ok":true}', size: 11 },
            { id: "image", type: "image", url: "https://example.com/image.png" },
            { id: "__summary__", type: "board_summary" },
          ],
          layouts: { lg: [{ i: "__summary__", x: 0, y: 0, w: 6, h: 4 }], sm: [] },
        },
      ],
      generation: {
        item_summaries: [],
        overall_summary: { title: "Summary", explanation: "Text", tags: ["tag"] },
      },
    });

    expect(canvas?.pages[0]?.items).toEqual([
      { id: "url", type: "url", url: "https://example.com/", platform: "website" },
      { id: "json", type: "json", name: "data.json", text: '{"ok":true}', size: 11 },
    ]);
    expect(canvas?.pages[0]?.layouts).toBeUndefined();
    expect(canvas && "generation" in canvas).toBe(false);
  });

  test("share request payloads parse through narrow item shapes", () => {
    const share = sanitizeShareRequestPayload({
      pages: [
        {
          id: "page",
          items: [
            {
              id: "image",
              type: "image",
              url: "blob:http://localhost/preview",
              previewUrl: "blob:http://localhost/preview",
              file: { name: "image.png" },
              caption: "  screenshot  ",
            },
            { id: "json", type: "json", name: " data.json ", text: ' {"ok":true} ', size: 11 },
          ],
        },
      ],
    });
    expect(share?.pages[0]?.items).toEqual([
      { id: "image", type: "image", caption: "screenshot" },
      { id: "json", type: "json", name: "data.json", text: '{"ok":true}', size: 11 },
    ]);
  });
});

describe("storage keys", () => {
  test("object keys stay relative and segment-safe", () => {
    expect(isSafeObjectKey("canvases/abc_123.json")).toBe(true);
    expect(isSafeObjectKey("images/board/page/item.png")).toBe(true);
    expect(isSafeObjectKey("../canvases/abc.json")).toBe(false);
    expect(isSafeObjectKey("/canvases/abc.json")).toBe(false);
    expect(isSafeObjectKey("images\\abc")).toBe(false);
    expect(isSafeObjectKey("images/has space")).toBe(false);
  });
});
