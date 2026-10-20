import { describe, expect, test } from "bun:test";
import { pagesFromBoard } from "./board-lifecycle";
import { parseBoardFetchResponse } from "./shared-board";

describe("shared board responses", () => {
  test("accept stored boards and bare locked stubs only", () => {
    expect(parseBoardFetchResponse({ id: "abc", encrypted: true, locked: true, data: "CIPHERTEXT" })).toEqual({
      id: "abc",
      encrypted: true,
      locked: true,
    });
    expect(
      parseBoardFetchResponse({
        id: "board",
        author: "Ada",
        createdAt: "2026-04-27T00:00:00.000Z",
        pages: [{ id: "page", items: [{ id: "note", type: "note", html: "hello" }] }],
      }),
    ).toMatchObject({ id: "board", author: "Ada", pages: [{ id: "page", items: [{ id: "note", type: "note", html: "hello" }] }] });
    expect(parseBoardFetchResponse({ nope: true })).toBeNull();
    expect(parseBoardFetchResponse(null)).toBeNull();
  });

  test("hydrates stored pages without synthetic summary cards", () => {
    const pages = pagesFromBoard({
      id: "board",
      author: "Ada",
      createdAt: "2026-04-27T00:00:00.000Z",
      pages: [
        { id: "p1", layouts: { lg: [], sm: [] }, items: [{ id: "note", type: "note", html: "hello" }] },
        {
          id: "p2",
          items: [{ id: "json", type: "json", name: "data.json", text: "{}", size: 2 }],
          layouts: { lg: [{ i: "json", x: 0, y: 0, w: 6, h: 4 }], sm: [] },
        },
      ],
    });
    expect(pages[0]?.items.map((item) => item.id)).toEqual(["note"]);
    expect(pages[1]?.items).toEqual([{ id: "json", type: "json", name: "data.json", text: "{}", size: 2 }]);
  });
});
