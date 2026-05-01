import { describe, expect, test } from "bun:test";
import {
  __boardLifecyclePolicyForTests,
  addItemWithSpillToPages,
  duplicateItemOnPage,
  editorPagesFromCanvas,
  emptyBoardPage,
  removeItemsFromPage,
} from "./board-lifecycle";
import { BOARD_SUMMARY_ITEM_ID, type BoardPage } from "./types";

const layouts = { lg: [], sm: [] };

describe("board lifecycle", () => {
  test("restores shared boards into editable pages with a synthetic summary card", () => {
    const pages = editorPagesFromCanvas({
      id: "shared",
      author: "Ada",
      createdAt: "2026-05-01T00:00:00.000Z",
      generation: {
        item_summaries: [],
        overall_summary: { title: "Summary", explanation: "", tags: [] },
      },
      pages: [
        {
          id: "page",
          items: [{ id: "note", type: "note", text: "hello" }],
        },
      ],
    });

    expect(pages).toEqual([
      {
        id: "page",
        layouts,
        items: [
          { id: "note", type: "note", text: "hello" },
          { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" },
        ],
      },
    ]);
  });

  test("removes items and their persisted layout entries together", () => {
    const page: BoardPage = {
      id: "page",
      items: [
        { id: "keep", type: "note", text: "keep" },
        { id: "drop", type: "note", text: "drop" },
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

  test("removes draft-image previews via adapter while applying pure state removal", () => {
    const page: BoardPage = {
      id: "page",
      items: [
        {
          id: "img",
          type: "image",
          file: new File(["x"], "x.png", { type: "image/png" }),
          previewUrl: "blob:img",
        },
        { id: "note", type: "note", text: "keep" },
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
    const ids = new Set(["img"]);

    const next = removeItemsFromPage(page, ids, {
      create() {
        throw new Error("not used");
      },
      revoke(url) {
        revoked.push(url);
      },
    });

    const pure = __boardLifecyclePolicyForTests.removeItemsFromPageState(page, ids);
    expect(next).toEqual(pure);
    expect(revoked).toEqual(["blob:img"]);
  });

  test("duplicates draft images via preview adapter", () => {
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
    const created: string[] = [];
    const result = duplicateItemOnPage(page, "img", 100, {
      create(file) {
        created.push(file.name);
        return "blob:new";
      },
      revoke() {
        throw new Error("not used");
      },
    });

    expect(result).not.toBeNull();
    expect(created).toEqual(["x.png"]);
    const duplicated = result!.page.items.find((item) => item.id === result!.newId);
    expect(duplicated).toMatchObject({ type: "image", previewUrl: "blob:new" });
  });

  test("spills a new item to the next page when the active page is full", () => {
    const fullPage: BoardPage = {
      id: "full",
      items: [{ id: "a", type: "note", text: "A".repeat(500) }],
      layouts: { lg: [{ i: "a", x: 0, y: 0, w: 24, h: 4 }], sm: [] },
    };

    const result = addItemWithSpillToPages({
      pages: [fullPage],
      activePage: 0,
      item: { id: "b", type: "note", text: "B".repeat(500) },
      maxRows: 1,
    });

    expect(result.landedIndex).toBe(1);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.items.map((item) => item.id)).toEqual(["a"]);
    expect(result.pages[1]?.items.map((item) => item.id)).toEqual(["b"]);
  });

  test("creates empty editable pages with required layout containers", () => {
    const page = emptyBoardPage();
    expect(page.items).toEqual([]);
    expect(page.layouts).toEqual(layouts);
  });
});
