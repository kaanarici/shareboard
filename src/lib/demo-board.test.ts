import { describe, expect, test } from "bun:test";
import { rectsOverlap } from "@/lib/auto-canvas/pack";
import { sanitizeLayouts, sanitizeStoredItem } from "@/lib/canvas-sanitize";
import { demoBoardPage } from "@/lib/demo-board";
import { LG_COLS } from "@/lib/tile-specs";

describe("demo board", () => {
  test("every item survives sanitizing and has a layout on both grids", () => {
    const page = demoBoardPage();
    expect(page.items.map((item) => sanitizeStoredItem(item))).toEqual(page.items);
    const ids = page.items.map((item) => item.id).sort();
    const layouts = sanitizeLayouts(page.layouts, page.items);
    expect(layouts.lg.map((layout) => layout.i).sort()).toEqual(ids);
    expect(layouts.sm.map((layout) => layout.i).sort()).toEqual(ids);
  });

  test("the desktop layout fits the grid without overlaps", () => {
    const { lg } = demoBoardPage().layouts;
    for (const layout of lg) expect(layout.x + layout.w).toBeLessThanOrEqual(LG_COLS);
    for (const [index, a] of lg.entries()) {
      for (const b of lg.slice(index + 1)) expect(rectsOverlap(a, b)).toBe(false);
    }
  });
});
