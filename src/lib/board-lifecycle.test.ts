import { describe, expect, test } from "bun:test";
import { defined } from "@/test/fixtures";
import {
  addItemWithSpillToPages,
  duplicateItemWithSpillToPages,
  pagesFromBoard,
  emptyBoardPage,
  pruneEmptyPages,
  removeItemsFromPage,
  revokeRemovedPreviews,
} from "./board-lifecycle";
import { isDraftImageItem, type BoardItem, type BoardPage } from "./types";

function duplicate(pages: BoardPage[], activePage: number, sourceId: string, maxRows: number, previewUrl: string) {
  const source = defined(pages[activePage]?.items.find((item) => item.id === sourceId), "source item");
  const id = `${sourceId}-copy`;
  const copy: BoardItem = isDraftImageItem(source) ? { ...source, id, previewUrl } : { ...source, id };
  return { ...duplicateItemWithSpillToPages({ pages, activePage, sourceId, copy, maxRows }), newId: id };
}

const layouts = { lg: [], sm: [] };

describe("board lifecycle", () => {
  test("restores shared boards into editable pages", () => {
    const pages = pagesFromBoard({
      id: "shared",
      author: "Ada",
      createdAt: "2026-05-01T00:00:00.000Z",
      pages: [
        {
          id: "page",
          layouts,
          items: [{ id: "note", type: "note", html: "hello" }],
        },
      ],
    });

    expect(pages).toEqual([
      {
        id: "page",
        layouts,
        items: [{ id: "note", type: "note", html: "hello" }],
      },
    ]);
  });

  test("removes items and their persisted layout entries together", () => {
    const page: BoardPage = {
      id: "page",
      items: [
        { id: "keep", type: "note", html: "keep" },
        { id: "drop", type: "note", html: "drop" },
      ],
      layouts: {
        lg: [
          { i: "keep", x: 0, y: 0, w: 4, h: 4 },
          { i: "drop", x: 4, y: 0, w: 4, h: 4 },
        ],
        sm: [
          { i: "keep", x: 0, y: 0, w: 1, h: 4 },
          { i: "drop", x: 0, y: 4, w: 1, h: 4 },
        ],
      },
    };

    const next = removeItemsFromPage(page, new Set(["drop"]));

    expect(next.items.map((item) => item.id)).toEqual(["keep"]);
    expect(next.layouts.lg.map((item) => item.i)).toEqual(["keep"]);
    expect(next.layouts.sm.map((item) => item.i)).toEqual(["keep"]);
  });

  test("prunes empty pages but keeps one editable fallback page", () => {
    const full: BoardPage = {
      id: "full",
      items: [{ id: "note", type: "note", html: "x" }],
      layouts: { lg: [{ i: "note", x: 0, y: 0, w: 4, h: 4 }], sm: [] },
    };

    expect(pruneEmptyPages([{ ...full, items: [], layouts }, full]).map((page) => page.id)).toEqual(["full"]);
    expect(pruneEmptyPages([{ ...full, items: [], layouts }])).toHaveLength(1);
  });

  test("removing items drops their layouts and revokes only the removed previews", () => {
    const page: BoardPage = {
      id: "page",
      items: [
        {
          id: "img",
          type: "image",
          file: new File(["x"], "x.png", { type: "image/png" }),
          previewUrl: "blob:img",
        },
        { id: "note", type: "note", html: "keep" },
      ],
      layouts: {
        lg: [
          { i: "img", x: 0, y: 0, w: 4, h: 4 },
          { i: "note", x: 4, y: 0, w: 4, h: 4 },
        ],
        sm: [
          { i: "img", x: 0, y: 0, w: 1, h: 4 },
          { i: "note", x: 0, y: 4, w: 1, h: 4 },
        ],
      },
    };
    const revoked: string[] = [];
    const realRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url) => revoked.push(url);
    const next = removeItemsFromPage(page, new Set(["img"]));
    revokeRemovedPreviews([page], [next]);
    URL.revokeObjectURL = realRevoke;

    expect(next.items.map((item) => item.id)).toEqual(["note"]);
    expect(next.layouts.lg.map((layout) => layout.i)).toEqual(["note"]);
    expect(next.layouts.sm.map((layout) => layout.i)).toEqual(["note"]);
    expect(revoked).toEqual(["blob:img"]);
  });

  test("duplicates draft images with their own preview URL", () => {
    const page: BoardPage = {
      id: "page",
      items: [
        {
          id: "img",
          type: "image",
          file: new File(["x"], "x.png", { type: "image/png" }),
          previewUrl: "blob:old",
        },
      ],
      layouts: { lg: [], sm: [] },
    };
    const result = duplicate([page], 0, "img", 100, "blob:new");

    expect(result).not.toBeNull();
        expect(result.landedIndex).toBe(0);
    const duplicated = result.pages[0]?.items.find((item) => item.id === result.newId);
    expect(duplicated).toMatchObject({ type: "image", previewUrl: "blob:new" });
  });

  test("duplicating a resized note keeps the source tile size", () => {
    const page: BoardPage = {
      id: "page",
      items: [{ id: "note", type: "note", html: "<p>hi</p>" }],
      layouts: { lg: [{ i: "note", x: 0, y: 0, w: 3, h: 4 }], sm: [] },
    };
    const result = duplicate([page], 0, "note", 100, "blob:copy");

    expect(result).not.toBeNull();
    const copyLayout = result.pages[0]?.layouts?.lg.find((l) => l.i === result.newId);
    expect(copyLayout).toMatchObject({ w: 3, h: 4 });
  });

  test("shrinks duplicated images into real gaps, then spills instead of repacking the page", () => {
    const file = new File(["x"], "avatar.png", { type: "image/png" });
    const img = (id: string) => ({
      id,
      type: "image" as const,
      file,
      previewUrl: `blob:${id}`,
      aspect: 1,
    });
    const page: BoardPage = {
      id: "page",
      items: ["a", "b", "c", "d", "e", "f", "g"].map(img),
      layouts: {
        lg: [
          { i: "a", x: 0, y: 0, w: 8, h: 13 },
          { i: "b", x: 8, y: 0, w: 8, h: 13 },
          { i: "c", x: 16, y: 0, w: 8, h: 13 },
          { i: "d", x: 0, y: 13, w: 5, h: 8 },
          { i: "e", x: 5, y: 13, w: 5, h: 8 },
          { i: "f", x: 10, y: 13, w: 5, h: 8 },
          { i: "g", x: 15, y: 13, w: 5, h: 8 },
        ],
        sm: [],
      },
    };

    const first = duplicate([page], 0, "g", 21, "blob:copy");

    expect(first).not.toBeNull();
    expect(first.landedIndex).toBe(0);
    expect(first.pages).toHaveLength(1);
    expect(first.pages[0]?.items).toHaveLength(8);
    expect(first.pages[0]?.layouts.lg.find((layout) => layout.i === first.newId)).toMatchObject({
      x: 20,
      y: 13,
      w: 4,
      h: 6,
    });

    const second = duplicate(first.pages, 0, first.newId, 21, "blob:copy-2");

    expect(second).not.toBeNull();
    expect(second.landedIndex).toBe(1);
    expect(second.pages).toHaveLength(2);
    expect(second.pages[0]?.layouts.lg).toEqual(first.pages[0]?.layouts.lg);
    expect(second.pages[1]?.items).toEqual([
      expect.objectContaining({ id: second.newId, type: "image", previewUrl: "blob:copy-2" }),
    ]);
  });

  test("keeps duplicated images at source size when that footprint fits", () => {
    const file = new File(["x"], "avatar.png", { type: "image/png" });
    const img = (id: string) => ({
      id,
      type: "image" as const,
      file,
      previewUrl: `blob:${id}`,
      aspect: 1,
    });
    const page: BoardPage = {
      id: "page",
      items: ["a", "b", "source"].map(img),
      layouts: {
        lg: [
          { i: "a", x: 0, y: 0, w: 8, h: 13 },
          { i: "b", x: 8, y: 0, w: 8, h: 13 },
          { i: "source", x: 0, y: 13, w: 5, h: 8 },
        ],
        sm: [],
      },
    };

    const result = duplicate([page], 0, "source", 21, "blob:copy");

    expect(result).not.toBeNull();
    expect(result.landedIndex).toBe(0);
    expect(result.pages[0]?.layouts.lg.find((layout) => layout.i === result.newId)).toMatchObject({
      w: 5,
      h: 8,
    });
  });

  test("keeps same-size duplicates in interior holes before spilling", () => {
    const file = new File(["x"], "avatar.png", { type: "image/png" });
    const img = (id: string) => ({
      id,
      type: "image" as const,
      file,
      previewUrl: `blob:${id}`,
    });
    const page: BoardPage = {
      id: "page",
      items: ["left", "source", "below", "right"].map(img),
      layouts: {
        lg: [
          { i: "left", x: 0, y: 0, w: 8, h: 12 },
          { i: "source", x: 8, y: 0, w: 8, h: 4 },
          { i: "below", x: 8, y: 8, w: 8, h: 4 },
          { i: "right", x: 16, y: 0, w: 8, h: 12 },
        ],
        sm: [],
      },
    };

    const result = duplicate([page], 0, "source", 12, "blob:copy");

    expect(result).not.toBeNull();
    expect(result.landedIndex).toBe(0);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.layouts.lg.find((layout) => layout.i === result.newId)).toMatchObject({
      x: 8,
      y: 4,
      w: 8,
      h: 4,
    });
  });

  test("normalizes stale source layouts before placing same-size image duplicates", () => {
    const file = new File(["x"], "avatar.png", { type: "image/png" });
    const page: BoardPage = {
      id: "page",
      items: [{ id: "source", type: "image", file, previewUrl: "blob:source", aspect: 1 }],
      layouts: {
        lg: [{ i: "source", x: 30, y: 999, w: 8, h: 13 }],
        sm: [],
      },
    };

    const result = duplicate([page], 0, "source", 21, "blob:copy");

    expect(result).not.toBeNull();
    expect(result.landedIndex).toBe(0);
    const bottom = result.pages[0]?.layouts.lg.reduce((max, layout) => Math.max(max, layout.y + layout.h), 0);
    expect(bottom).toBeLessThanOrEqual(21);
    expect(result.pages[0]?.layouts.lg.find((layout) => layout.i === result.newId)).toMatchObject({
      w: 8,
      h: 13,
    });
  });

  test("spills a new item to the next page when the active page is full", () => {
    const fullPage: BoardPage = {
      id: "full",
      items: [{ id: "a", type: "note", html: "A".repeat(500) }],
      layouts: { lg: [{ i: "a", x: 0, y: 0, w: 24, h: 4 }], sm: [] },
    };

    const result = addItemWithSpillToPages({
      pages: [fullPage],
      activePage: 0,
      item: { id: "b", type: "note", html: "B".repeat(500) },
      maxRows: 1,
    });

    expect(result.landedIndex).toBe(1);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.items.map((item) => item.id)).toEqual(["a"]);
    expect(result.pages[1]?.items.map((item) => item.id)).toEqual(["b"]);
  });

  test("keeps a single oversized new-page item inside the row budget", () => {
    const result = addItemWithSpillToPages({
      pages: [emptyBoardPage()],
      activePage: 0,
      item: { id: "url", type: "url", url: "https://example.com", platform: "website" },
      maxRows: 4,
    });

    expect(result.landedIndex).toBe(0);
    expect(result.pages).toHaveLength(1);
    const layout = result.pages[0]?.layouts.lg[0];
    expect(layout).toMatchObject({ i: "url", y: 0, h: 4 });
    expect(defined(layout).y + defined(layout).h).toBeLessThanOrEqual(4);
  });

  test("continues past existing full pages instead of overfilling the next page", () => {
    const fullPage = (id: string, itemId: string): BoardPage => ({
      id,
      items: [{ id: itemId, type: "note", html: "x" }],
      layouts: { lg: [{ i: itemId, x: 0, y: 0, w: 24, h: 4 }], sm: [] },
    });

    const result = addItemWithSpillToPages({
      pages: [fullPage("p1", "a"), fullPage("p2", "b")],
      activePage: 0,
      item: { id: "c", type: "note", html: "new" },
      maxRows: 3,
    });

    expect(result.landedIndex).toBe(2);
    expect(result.pages).toHaveLength(3);
    expect(result.pages[0]?.items.map((item) => item.id)).toEqual(["a"]);
    expect(result.pages[1]?.items.map((item) => item.id)).toEqual(["b"]);
    expect(result.pages[2]?.items.map((item) => item.id)).toEqual(["c"]);
  });

  test("bulk image placement keeps every populated page within the row budget", () => {
    const file = new File(["x"], "avatar.webp", { type: "image/webp" });
    let pages = [emptyBoardPage()];
    let pageIndex = 0;

    for (let index = 0; index < 24; index++) {
      const result = addItemWithSpillToPages({
        pages,
        activePage: pageIndex,
        item: {
          id: `img-${index}`,
          type: "image",
          file,
          previewUrl: `blob:${index}`,
          aspect: 1,
          size: file.size,
        },
        maxRows: 21,
      });
      pages = result.pages;
      pageIndex = result.landedIndex;
    }

    expect(pages.flatMap((page) => page.items)).toHaveLength(24);
    for (const page of pages) {
      const bottom = page.layouts.lg.reduce((max, layout) => Math.max(max, layout.y + layout.h), 0);
      expect(bottom).toBeLessThanOrEqual(21);
    }
  });

  test("creates empty editable pages with required layout containers", () => {
    const page = emptyBoardPage();
    expect(page.items).toEqual([]);
    expect(page.layouts).toEqual(layouts);
  });
});
