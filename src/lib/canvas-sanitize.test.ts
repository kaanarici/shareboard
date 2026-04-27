import { describe, expect, test } from "bun:test";
import {
  sanitizeGenerateRequestPayload,
  sanitizePublicCanvasManifest,
  sanitizeShareRequestPayload,
  sanitizeTinyCanvas,
} from "./canvas-sanitize";
import { isSafeObjectKey } from "./storage-keys";
import { BOARD_SUMMARY_ITEM_ID } from "./types";

describe("canvas sanitizers", () => {
  test("public manifests drop draft-only image state and synthetic summary items", () => {
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
            { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" },
            { id: "note", type: "note", text: "hello" },
          ],
        },
      ],
      generation: {
        item_summaries: [],
        overall_summary: { title: "Summary", explanation: "Text", tags: ["tag"] },
      },
    });

    expect(canvas?.pages[0]?.items).toEqual([{ id: "note", type: "note", text: "hello" }]);
    expect(canvas?.generation?.overall_summary.title).toBe("Summary");
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

  test("tiny shares keep only text and URL items", () => {
    const canvas = sanitizeTinyCanvas({
      id: "tiny",
      author: "Ada",
      pages: [
        {
          id: "page",
          items: [
            { id: "url", type: "url", url: "https://example.com", platform: "website" },
            { id: "image", type: "image", url: "https://example.com/image.png" },
            { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" },
          ],
        },
      ],
    });

    expect(canvas?.pages[0]?.items).toEqual([
      { id: "url", type: "url", url: "https://example.com/", platform: "website" },
    ]);
  });

  test("share and generate request payloads parse through narrow item shapes", () => {
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
          ],
        },
      ],
    });
    expect(share?.pages[0]?.items).toEqual([
      { id: "image", type: "image", caption: "screenshot" },
    ]);

    const generate = sanitizeGenerateRequestPayload({
      items: [
        {
          id: "image",
          type: "image",
          url: "blob:http://localhost/preview",
          previewUrl: "blob:http://localhost/preview",
          file: { name: "image.png" },
          caption: "  screenshot  ",
        },
      ],
    });
    expect(generate?.items).toEqual([{ id: "image", type: "image", caption: "screenshot" }]);
  });

  test("generation sanitizer preserves the declared item summary shape", () => {
    const canvas = sanitizePublicCanvasManifest({
      id: "board",
      author: "Ada",
      pages: [{ id: "page", items: [{ id: "note", type: "note", text: "hello" }] }],
      generation: {
        item_summaries: [
          {
            item_id: "note",
            title: "Title",
            summary: "Summary",
            source_type: "note",
            author: "Ada",
            key_quote: "hello",
            extra: "ignored",
          },
        ],
        overall_summary: { title: "Overall", explanation: "Text", tags: ["tag"] },
      },
    });

    expect(canvas?.generation?.item_summaries).toEqual([
      {
        item_id: "note",
        title: "Title",
        summary: "Summary",
        source_type: "note",
        author: "Ada",
        key_quote: "hello",
      },
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
