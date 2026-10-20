import { describe, expect, test } from "bun:test";
import { sanitizeShareRequest, sanitizeStoredBoard, sanitizeTextBoard } from "./canvas-sanitize";
import { isPublicObjectKey, isSafeObjectKey } from "./storage-keys";

describe("canvas sanitizers", () => {
  test("public manifests drop draft-only image state", () => {
    const canvas = sanitizeStoredBoard({
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
            { id: "note", type: "note", html: "hello" },
          ],
          layouts: {
            lg: [
              { i: "draft-image", x: 0, y: 0, w: 6, h: 4 },
              { i: "note", x: 6, y: 0, w: 6, h: 4 },
            ],
            sm: [{ i: "draft-image", x: 0, y: 0, w: 1, h: 4 }],
          },
        },
      ],
    });

    expect(canvas?.pages[0]?.items).toEqual([{ id: "note", type: "note", html: "hello" }]);
    expect(canvas?.pages[0]?.layouts).toEqual({ lg: [{ i: "note", x: 6, y: 0, w: 6, h: 4 }], sm: [] });
  });

  test("image URLs are always derived from a safe images/ object key", () => {
    const canvas = sanitizeStoredBoard({
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
        url: "/api/objects?key=images%2Fboard%2Fpage%2Fimage",
        objectKey: "images/board/page/image",
      },
    ]);
  });

  test("public manifests keep local object proxy URLs", () => {
    const canvas = sanitizeStoredBoard({
      id: "board",
      author: "Ada",
      createdAt: "2026-04-27T00:00:00.000Z",
      previewUrl: "/api/objects?key=previews/board/page/image",
      pages: [
        {
          id: "page",
          items: [
            {
              id: "image",
              type: "image",
              url: "/api/objects?key=images/board/page/image",
              objectKey: "images/board/page/image",
            },
            {
              id: "bad",
              type: "image",
              url: "/api/objects?key=canvases/board.json",
              objectKey: "canvases/board.json",
            },
          ],
        },
      ],
    });

    expect(canvas?.previewUrl).toBe("/api/objects?key=previews%2Fboard%2Fpage%2Fimage");
    expect(canvas?.pages[0]?.items).toEqual([
      {
        id: "image",
        type: "image",
        url: "/api/objects?key=images%2Fboard%2Fpage%2Fimage",
        objectKey: "images/board/page/image",
      },
    ]);
  });

  test("tiny shares keep text, URL, and JSON items", () => {
    const canvas = sanitizeTextBoard({
      id: "tiny",
      author: "Ada",
      pages: [
        {
          id: "page",
          items: [
            { id: "url", type: "url", url: "https://example.com", platform: "website" },
            { id: "json", type: "json", name: "data.json", text: '{"ok":true}', size: 11 },
            { id: "image", type: "image", url: "https://example.com/image.png" },
          ],
          layouts: { lg: [{ i: "image", x: 0, y: 0, w: 6, h: 4 }], sm: [] },
        },
      ],
    });

    expect(canvas?.pages[0]?.items).toEqual([
      { id: "url", type: "url", url: "https://example.com/", platform: "website" },
      { id: "json", type: "json", name: "data.json", text: '{"ok":true}', size: 11 },
    ]);
    expect(canvas?.pages[0]?.layouts).toEqual({ lg: [], sm: [] });
  });

  test("duplicate page or item ids reject the whole document", () => {
    expect(
      sanitizeStoredBoard({
        id: "board",
        author: "Ada",
        pages: [
          { id: "page", items: [{ id: "note", type: "note", html: "a" }] },
          { id: "page", items: [{ id: "other", type: "note", html: "b" }] },
        ],
      }),
    ).toBeNull();
    expect(
      sanitizeStoredBoard({
        id: "board",
        author: "Ada",
        pages: [
          {
            id: "page",
            items: [
              { id: "note", type: "note", html: "a" },
              { id: "note", type: "note", html: "b" },
            ],
          },
        ],
      }),
    ).toBeNull();
  });

  test("shared images recover objectKey from a local objects URL", () => {
    const canvas = sanitizeStoredBoard({
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
              url: "/api/objects?key=images/board/hash",
            },
          ],
        },
      ],
    });
    expect(canvas?.pages[0]?.items).toEqual([
      {
        id: "image",
        type: "image",
        url: "/api/objects?key=images%2Fboard%2Fhash",
        objectKey: "images/board/hash",
      },
    ]);
  });

  test("stored boards cannot point images or previews at outside or private URLs", () => {
    const canvas = sanitizeStoredBoard({
      id: "board",
      author: "Ada",
      previewUrl: "https://tracker.example/pixel.png",
      pages: [
        {
          id: "page",
          items: [
            { id: "external", type: "image", url: "https://evil.example/x.png" },
            { id: "script", type: "image", url: "javascript:alert(1)", objectKey: "images/a/b" },
            { id: "manifest", type: "image", url: "/api/objects?key=canvases%2Fx.json" },
            { id: "locked", type: "image", objectKey: "locked/abc.json" },
            { id: "note", type: "note", html: "kept" },
          ],
        },
      ],
    });
    expect(canvas?.previewUrl).toBeUndefined();
    expect(canvas?.pages[0]?.items).toEqual([
      { id: "script", type: "image", url: "/api/objects?key=images%2Fa%2Fb", objectKey: "images/a/b" },
      { id: "note", type: "note", html: "kept" },
    ]);
  });

  test("links, profile URLs, and OG images must be http(s)", () => {
    const canvas = sanitizeTextBoard({
      author: "Ada",
      authorProfile: { xUrl: "javascript:alert(1)", linkedinUrl: "https://linkedin.com/in/ada" },
      pages: [
        {
          id: "page",
          items: [
            { id: "bad", type: "url", url: "javascript:alert(1)", platform: "website" },
            { id: "data", type: "url", url: "data:text/html,<script>1</script>", platform: "website" },
            {
              id: "ok",
              type: "url",
              url: "https://example.com",
              platform: "website",
              ogData: { title: "T", image: "javascript:alert(1)" },
            },
          ],
        },
      ],
    });
    expect(canvas?.authorProfile).toEqual({ linkedinUrl: "https://linkedin.com/in/ada" });
    expect(canvas?.pages[0]?.items).toEqual([
      { id: "ok", type: "url", url: "https://example.com/", platform: "website", ogData: { title: "T" } },
    ]);
  });

  test("text boards are capped to the board page and item limits", () => {
    const pages = Array.from({ length: 20 }, (_, p) => ({
      id: `p${p}`,
      items: Array.from({ length: 70 }, (_, i) => ({ id: `n${p}-${i}`, type: "note", html: "x" })),
    }));
    const canvas = sanitizeTextBoard({ pages });
    expect(canvas?.pages).toHaveLength(12);
    expect(canvas?.pages[0]?.items).toHaveLength(60);
  });

  test("share request payloads parse through narrow item shapes", () => {
    const share = sanitizeShareRequest({
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

  test("object proxy keys are public bytes only", () => {
    expect(isPublicObjectKey("images/board/hash")).toBe(true);
    expect(isPublicObjectKey("locked-images/abc")).toBe(true);
    expect(isPublicObjectKey("previews/board/hash.png")).toBe(true);
    expect(isPublicObjectKey("intake/id/0")).toBe(false);
    expect(isPublicObjectKey("canvases/board.json")).toBe(false);
    expect(isPublicObjectKey("handoff/abc.json")).toBe(false);
  });
});
