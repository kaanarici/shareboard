import { describe, expect, test } from "bun:test";
import { hydrateSharedBoardPages, resolveStoredSharedBoard } from "./shared-board";
import { BOARD_SUMMARY_ITEM_ID } from "./types";

describe("shared-board", () => {
  test("resolves stored board payloads and locked stubs", () => {
    expect(resolveStoredSharedBoard({ id: "abc", encrypted: true, locked: true })).toEqual({
      id: "abc",
      encrypted: true,
      locked: true,
    });

    const resolved = resolveStoredSharedBoard({
      id: "board",
      author: "Ada",
      createdAt: "2026-04-27T00:00:00.000Z",
      pages: [{ id: "page", items: [{ id: "note", type: "note", text: "hello" }] }],
    });

    expect(resolved).toMatchObject({
      id: "board",
      author: "Ada",
      pages: [{ id: "page", items: [{ id: "note", type: "note", text: "hello" }] }],
    });
    expect(resolveStoredSharedBoard({ nope: true })).toBeNull();
  });

  test("hydrates first page summary card and default layouts", () => {
    const pages = hydrateSharedBoardPages({
      id: "board",
      author: "Ada",
      createdAt: "2026-04-27T00:00:00.000Z",
      generation: {
        item_summaries: [],
        overall_summary: { title: "Summary", explanation: "Text", tags: [] },
      },
      pages: [
        { id: "p1", items: [{ id: "note", type: "note", text: "hello" }] },
        {
          id: "p2",
          items: [{ id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" }],
          layouts: { lg: [{ i: BOARD_SUMMARY_ITEM_ID, x: 0, y: 0, w: 6, h: 4 }], sm: [] },
        },
      ],
    });

    expect(pages[0]?.items.map((item) => item.id)).toEqual(["note", BOARD_SUMMARY_ITEM_ID]);
    expect(pages[0]?.layouts).toEqual({ lg: [], sm: [] });
    expect(pages[1]?.items).toEqual([{ id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" }]);
  });
});
