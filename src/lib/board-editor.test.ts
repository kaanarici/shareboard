import { afterEach, describe, expect, test } from "bun:test";
import { boardBudgetError } from "./board-editor";
import { emptyBoardPage, placeItemsWithSpill, revokeRemovedPreviews, withFreshPreviews } from "./board-lifecycle";
import { LIMITS } from "./limits";
import type { BoardItem, BoardPage, DraftImageItem } from "./types";

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

afterEach(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

function note(id: string, html = "note"): BoardItem {
  return { id, type: "note", html };
}

function image(id: string, size = 10): DraftImageItem {
  return { id, type: "image", file: new File(["x"], `${id}.png`, { type: "image/png" }), previewUrl: `blob:${id}`, size };
}

function pageOf(id: string, items: BoardItem[]): BoardPage {
  return {
    id,
    items,
    layouts: {
      lg: items.map((item, index) => ({ i: item.id, x: 0, y: index * 8, w: 12, h: 8 })),
      sm: items.map((item, index) => ({ i: item.id, x: 0, y: index * 8, w: 1, h: 8 })),
    },
  };
}

describe("item placement", () => {
  test("spilling items selects them on the page they landed on", () => {
    const full = pageOf("p1", [note("a", "a".repeat(40)), note("b"), note("c")]);
    const result = placeItemsWithSpill({ pages: [full], activePage: 0, items: [note("d", "spilled")], maxRows: 8 });
    expect(result.landedIndex).toBeGreaterThan(0);
    expect(result.selectedIds).toEqual(["d"]);
    expect(result.pages[result.landedIndex]?.items.map((item) => item.id)).toEqual(["d"]);
  });

  test("an empty board does not invent a spill page", () => {
    const result = placeItemsWithSpill({ pages: [emptyBoardPage()], activePage: 0, items: [note("n")], maxRows: 12 });
    expect(result.pages).toHaveLength(1);
    expect(result.landedIndex).toBe(0);
  });
});

describe("preview URL ownership", () => {
  test("only previews that leave the board are revoked", () => {
    const revoked: string[] = [];
    URL.revokeObjectURL = (url) => revoked.push(url);
    const before = [pageOf("p", [image("keep"), image("drop")])];
    const after = [pageOf("p", [image("keep")])];
    revokeRemovedPreviews(before, after);
    expect(revoked).toEqual(["blob:drop"]);
  });

  test("restoring an undone board mints new previews from the kept files", () => {
    let counter = 0;
    URL.createObjectURL = () => `blob:fresh-${++counter}`;
    const restored = withFreshPreviews([pageOf("p", [image("a"), note("n")])]);
    expect(restored[0]?.items[0]).toMatchObject({ id: "a", previewUrl: "blob:fresh-1" });
    expect(restored[0]?.items[1]).toEqual(note("n"));
  });
});

describe("board budgets", () => {
  test("reports the image and JSON allowances with the existing copy", () => {
    const pages = [pageOf("p", [image("big", LIMITS.maxBoardImageBytes)])];
    expect(boardBudgetError(pages, [image("one-more", 1)])).toBe("Boards can hold up to 16 MB of images");
    const json: BoardItem = { id: "j", type: "json", name: "a.json", text: "{}", size: LIMITS.maxBoardJsonBytes + 1 };
    expect(boardBudgetError([], [json])).toBe("Boards can hold up to 2 MB of JSON");
    expect(boardBudgetError([], [note("fine")])).toBeNull();
  });
});
