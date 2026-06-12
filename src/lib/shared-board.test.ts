import { describe, expect, test } from "bun:test";
import { hydrateSharedBoardPages, resolveStoredSharedBoard } from "./shared-board";

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

  test("hydrates stored pages without synthetic summary cards", () => {
    const pages = hydrateSharedBoardPages({
      id: "board",
      author: "Ada",
      createdAt: "2026-04-27T00:00:00.000Z",
      pages: [
        { id: "p1", items: [{ id: "note", type: "note", text: "hello" }] },
        {
          id: "p2",
          items: [{ id: "json", type: "json", name: "data.json", text: "{}", size: 2 }],
          layouts: { lg: [{ i: "json", x: 0, y: 0, w: 6, h: 4 }], sm: [] },
        },
      ],
    });

    expect(pages[0]?.items.map((item) => item.id)).toEqual(["note"]);
    expect(pages[0]?.layouts).toEqual({ lg: [], sm: [] });
    expect(pages[1]?.items).toEqual([{ id: "json", type: "json", name: "data.json", text: "{}", size: 2 }]);
  });
});
