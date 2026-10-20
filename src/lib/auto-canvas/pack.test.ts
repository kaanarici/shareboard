import { describe, expect, test } from "bun:test";
import { defined } from "@/test/fixtures";
import {
  chooseRows,
  chooseSpan,
  pxToRows,
  colSpanToPx,
  mergeLayout,
  normalizeLayoutItem,
  resolveDisplacedLayout,
  resolveGroupedDragLayout,
} from "./pack";
import type { LayoutItem } from "react-grid-layout";
import type { TileSpec } from "./types";

const OPTS = {
  columns: 24,
  containerWidth: 1440,
  rowHeight: 20,
  gap: 12,
  maxRows: 30,
};

describe("colSpanToPx", () => {
  test("full-column span equals container width", () => {
    expect(colSpanToPx(OPTS.columns, OPTS)).toBeCloseTo(OPTS.containerWidth, 5);
  });
});

describe("chooseSpan", () => {
  test("respects maxWidthPx, then rounds down to a row-tiling span", () => {
    const span = chooseSpan({ aspect: 2, maxWidthPx: 550, minSpan: 3 }, OPTS);
    expect(colSpanToPx(span, OPTS)).toBeLessThanOrEqual(550);
    expect(span).toBe(8);
  });
  test("falls back to minSpan when minSpan already exceeds maxWidthPx", () => {
    const narrow = { ...OPTS, containerWidth: 3840 };
    const span = chooseSpan({ maxWidthPx: 300, minSpan: 4 }, narrow);
    expect(span).toBe(4);
  });
  test("rounds preferredSpan down to a row-tiling span", () => {
    expect(chooseSpan({ preferredSpan: 10 }, OPTS)).toBe(8);
  });
  test("clamps preferredSpan to minSpan", () => {
    expect(chooseSpan({ preferredSpan: 1, minSpan: 4 }, OPTS)).toBe(4);
  });
});

describe("chooseRows", () => {
  test("derives height from aspect", () => {
    const rows = chooseRows({ aspect: 2 }, 10, OPTS);
    const pxW = colSpanToPx(10, OPTS);
    const expected = pxToRows(pxW / 2, OPTS);
    expect(rows).toBe(Math.max(3, Math.round(expected)));
  });
  test("uses preferredRows when aspect absent", () => {
    expect(chooseRows({ preferredRows: 12 }, 8, OPTS)).toBe(12);
  });
  test("respects minRows", () => {
    expect(chooseRows({ preferredRows: 1, minRows: 5 }, 8, OPTS)).toBe(5);
  });
});

describe("fresh layouts", () => {
  test("empty input produces empty layout", () => {
    expect(mergeLayout([], [], OPTS)).toEqual([]);
  });
  test("reports overflow rather than crushing tiles below minRows", () => {
    const specs: Array<{ id: string } & TileSpec> = Array.from({ length: 10 }, (_, i) => ({
      id: `tile${i}`,
      preferredSpan: 12,
      preferredRows: 20,
      minRows: 3,
    }));
    const packed = mergeLayout([], specs, { ...OPTS, maxRows: 10 });
    expect(packed).toHaveLength(10);
    for (const l of packed) {
      expect(l.h).toBeGreaterThanOrEqual(3);
    }
  });
  test("aspect-locked tiles get heights derived from span", () => {
    const packed = mergeLayout([], 
      [{ id: "square", aspect: 1, preferredSpan: 8, minSpan: 3 }],
      OPTS,
    );
    expect(packed[0]?.h).toBe(15);
  });
  test("does not shrink aspect-locked new tiles below explicit minSpan to satisfy maxRows", () => {
    const merged = mergeLayout(
      [],
      [{ id: "image", aspect: 1, preferredSpan: 8, minSpan: 3 }],
      { ...OPTS, maxRows: 5 },
    );

    expect(merged[0]).toMatchObject({ i: "image", x: 0, y: 0, w: 3, h: 6 });
    expect(defined(merged[0]).y + defined(merged[0]).h).toBeGreaterThan(5);
  });
});

describe("mergeLayout", () => {
  test("normalizes raw layout items into clone-safe grid records", () => {
    const raw: LayoutItem & { constrainPosition: () => { x: number; y: number } } = {
      i: "a",
      x: -2,
      y: 99,
      w: 30,
      h: 8,
      minW: 40,
      minH: 20,
      maxW: 1,
      maxH: 1,
      constrainPosition() {
        return { x: 0, y: 0 };
      },
    };
    const normalized = normalizeLayoutItem(raw, { columns: 24, maxRows: 12 });

    expect(normalized).toEqual({
      i: "a",
      x: 0,
      y: 4,
      w: 24,
      h: 8,
      minW: 24,
      minH: 8,
      maxW: 24,
      maxH: 8,
    });
  });

  test("keeps persisted x/y/h for known ids (w may grow via justify-flex)", () => {
    const persisted = [
      { i: "a", x: 6, y: 0, w: 6, h: 5, minW: 3, minH: 3 },
    ];
    const merged = mergeLayout(
      persisted,
      [{ id: "a", preferredSpan: 12, preferredRows: 10 }],
      OPTS,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ i: "a", x: 6, y: 0, h: 5 });
    expect(merged[0]?.w).toBeGreaterThanOrEqual(6);
  });
  test("packs new ids around persisted tiles", () => {
    const persisted = [{ i: "old", x: 0, y: 0, w: 12, h: 6 }];
    const merged = mergeLayout(
      persisted,
      [
        { id: "old", preferredSpan: 12, preferredRows: 6 },
        { id: "new", preferredSpan: 12, preferredRows: 6 },
      ],
      OPTS,
    );
    const newTile = defined(merged.find((l) => l.i === "new"));
    expect(newTile).toMatchObject({ x: 12, y: 0 });
  });
  test("packs new ids into interior holes before spilling", () => {
    const persisted = [
      { i: "left", x: 0, y: 0, w: 8, h: 12 },
      { i: "top", x: 8, y: 0, w: 8, h: 4 },
      { i: "bottom", x: 8, y: 8, w: 8, h: 4 },
      { i: "right", x: 16, y: 0, w: 8, h: 12 },
    ];
    const merged = mergeLayout(
      persisted,
      [
        { id: "left", preferredSpan: 8, preferredRows: 12 },
        { id: "top", preferredSpan: 8, preferredRows: 4 },
        { id: "bottom", preferredSpan: 8, preferredRows: 4 },
        { id: "right", preferredSpan: 8, preferredRows: 12 },
        { id: "new", preferredSpan: 8, preferredRows: 4 },
      ],
      { ...OPTS, maxRows: 12 },
    );

    expect(merged.find((l) => l.i === "new")).toMatchObject({ x: 8, y: 4, w: 8, h: 4 });
  });
  test("preserves persisted positions and reports overflow when a merge cannot fit", () => {
    const persisted = [
      { i: "a", x: 0, y: 0, w: 12, h: 5 },
      { i: "b", x: 12, y: 0, w: 12, h: 5 },
      { i: "c", x: 0, y: 5, w: 12, h: 5 },
      { i: "d", x: 12, y: 5, w: 12, h: 5 },
    ];
    const merged = mergeLayout(
      persisted,
      [
        { id: "a", preferredSpan: 12, preferredRows: 5 },
        { id: "b", preferredSpan: 12, preferredRows: 5 },
        { id: "c", preferredSpan: 12, preferredRows: 5 },
        { id: "d", preferredSpan: 12, preferredRows: 5 },
        { id: "e", preferredSpan: 12, preferredRows: 5 },
      ],
      { ...OPTS, maxRows: 10 },
    );
    const bottom = merged.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    expect(bottom).toBeGreaterThan(10);
    expect(merged.find((l) => l.i === "a")).toMatchObject({ x: 0, y: 0, w: 12, h: 5 });
    expect(merged.find((l) => l.i === "d")).toMatchObject({ x: 12, y: 5, w: 12, h: 5 });
    expect(merged.map((l) => l.i).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
  test("drops stale persisted ids that no longer exist in specs", () => {
    const merged = mergeLayout(
      [{ i: "zombie", x: 0, y: 0, w: 4, h: 4 }],
      [{ id: "fresh", preferredSpan: 4, preferredRows: 4 }],
      OPTS,
    );
    expect(merged.map((l) => l.i)).toEqual(["fresh"]);
  });
  test("normalizes persisted layouts back inside the grid and row budget", () => {
    const merged = mergeLayout(
      [
        { i: "wide", x: -5, y: -2, w: 40, h: 6, minW: 30 },
        { i: "low", x: 20, y: 99, w: 8, h: 12, minH: 30 },
      ],
      [
        { id: "wide", preferredSpan: 8, preferredRows: 6 },
        { id: "low", preferredSpan: 8, preferredRows: 12 },
      ],
      { ...OPTS, maxRows: 18 },
    );

    expect(merged.find((l) => l.i === "wide")).toMatchObject({ x: 0, y: 0, w: 24 });
    expect(merged.find((l) => l.i === "wide")?.minW).toBe(24);
    const low = defined(merged.find((l) => l.i === "low"));
    expect(low.x + low.w).toBeLessThanOrEqual(OPTS.columns);
    expect(low.y + low.h).toBeLessThanOrEqual(18);
    expect(low.minH).toBe(low.h);
  });
  test("repacks overlapping persisted layouts instead of preserving collisions", () => {
    const merged = mergeLayout(
      [
        { i: "a", x: 0, y: 0, w: 12, h: 6 },
        { i: "b", x: 0, y: 0, w: 12, h: 6 },
      ],
      [
        { id: "a", preferredSpan: 12, preferredRows: 6 },
        { id: "b", preferredSpan: 12, preferredRows: 6 },
      ],
      OPTS,
    );

    expect(merged.find((l) => l.i === "a")).toMatchObject({ x: 0, y: 0 });
    expect(merged.find((l) => l.i === "b")).toMatchObject({ x: 12, y: 0 });
  });
  test("drops malformed persisted coordinates and repacks the tile", () => {
    const merged = mergeLayout(
      [{ i: "bad", x: Number.NaN, y: 0, w: 8, h: 6 }],
      [{ id: "bad", preferredSpan: 8, preferredRows: 6 }],
      OPTS,
    );

    expect(merged).toEqual([expect.objectContaining({ i: "bad", x: 0, y: 0, w: 8, h: 6 })]);
  });
});

describe("resolveDisplacedLayout", () => {
  test("swaps a displaced card into the moved card's vacated slot", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
    ];
    const next = [
      { i: "a", x: 8, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
    ];

    const resolved = resolveDisplacedLayout(next, before, "a", { columns: 24, maxRows: 12 });

    expect(resolved?.find((item) => item.i === "a")).toMatchObject({ x: 8, y: 0 });
    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 0, y: 0 });
  });

  test("inserts through a same-size row instead of directly swapping endpoints", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
      { i: "c", x: 16, y: 0, w: 8, h: 6 },
    ];
    const next = [
      { i: "a", x: 16, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
      { i: "c", x: 16, y: 0, w: 8, h: 6 },
    ];

    const resolved = resolveDisplacedLayout(next, before, "a", { columns: 24, maxRows: 6 });

    expect(resolved?.find((item) => item.i === "a")).toMatchObject({ x: 16, y: 0 });
    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 0, y: 0 });
    expect(resolved?.find((item) => item.i === "c")).toMatchObject({ x: 8, y: 0 });
  });

  test("swaps equal cards across rows instead of reflowing the grid", () => {
    const cell = (i: string, col: number, row: number) => ({ i, x: col * 8, y: row * 6, w: 8, h: 6 });
    const before = [cell("a", 0, 0), cell("b", 1, 0), cell("c", 2, 0), cell("d", 0, 1), cell("e", 1, 1), cell("f", 2, 1)];
    const next = before.map((item) => (item.i === "b" ? { ...item, y: 6 } : { ...item }));

    const resolved = resolveDisplacedLayout(next, before, "b", { columns: 24, maxRows: 12 });

    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 8, y: 6 });
    expect(resolved?.find((item) => item.i === "e")).toMatchObject({ x: 8, y: 0 });
    for (const id of ["a", "c", "d", "f"]) {
      expect(resolved?.find((item) => item.i === id)).toEqual(before.find((item) => item.i === id));
    }
  });

  test("pushes a partially overlapped card in the drag direction when space exists", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
    ];
    const next = [
      { i: "a", x: 4, y: 0, w: 8, h: 6 },
      { i: "b", x: 8, y: 0, w: 8, h: 6 },
    ];

    const resolved = resolveDisplacedLayout(next, before, "a", { columns: 24, maxRows: 12 });

    expect(resolved?.find((item) => item.i === "a")).toMatchObject({ x: 4, y: 0 });
    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 12, y: 0 });
  });

  test("cascades a partial push through adjacent cards when space exists", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 6, h: 6 },
      { i: "c", x: 12, y: 0, w: 6, h: 6 },
    ];
    const next = [
      { i: "a", x: 3, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 6, h: 6 },
      { i: "c", x: 12, y: 0, w: 6, h: 6 },
    ];

    const resolved = resolveDisplacedLayout(next, before, "a", { columns: 24, maxRows: 6 });

    expect(resolved?.find((item) => item.i === "a")).toMatchObject({ x: 3, y: 0 });
    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 9, y: 0 });
    expect(resolved?.find((item) => item.i === "c")).toMatchObject({ x: 15, y: 0 });
  });

  test("returns null when no non-overlapping displaced layout fits", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 18, h: 6 },
    ];
    const next = [
      { i: "a", x: 6, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 18, h: 6 },
    ];

    expect(resolveDisplacedLayout(next, before, "a", { columns: 24, maxRows: 6 })).toBeNull();
  });

  test("finds a legal displaced slot when there is no row budget", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 12, h: 6 },
      { i: "b", x: 12, y: 0, w: 12, h: 6 },
      { i: "c", x: 0, y: 6, w: 12, h: 6 },
    ];
    const next = [
      { i: "a", x: 12, y: 0, w: 12, h: 6 },
      { i: "b", x: 12, y: 0, w: 12, h: 6 },
      { i: "c", x: 0, y: 6, w: 12, h: 6 },
    ];

    const resolved = resolveDisplacedLayout(next, before, "a", { columns: 24 });

    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 0, y: 0 });
  });
});

describe("resolveGroupedDragLayout", () => {
  test("moves selected items together while preserving relative positions", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 6, h: 6 },
      { i: "c", x: 18, y: 0, w: 6, h: 6 },
    ];
    const next = [
      { i: "a", x: 3, y: 4, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 6, h: 6 },
      { i: "c", x: 18, y: 0, w: 6, h: 6 },
    ];

    const resolved = resolveGroupedDragLayout(next, before, "a", ["a", "b"], { columns: 24, maxRows: 12 });

    expect(resolved?.find((item) => item.i === "a")).toMatchObject({ x: 3, y: 4 });
    expect(resolved?.find((item) => item.i === "b")).toMatchObject({ x: 9, y: 4 });
    expect(resolved?.find((item) => item.i === "c")).toMatchObject({ x: 18, y: 0 });
  });

  test("rejects grouped moves that collide with unselected cards", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 6, h: 6 },
      { i: "c", x: 12, y: 0, w: 6, h: 6 },
    ];
    const next = [
      { i: "a", x: 6, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 6, h: 6 },
      { i: "c", x: 12, y: 0, w: 6, h: 6 },
    ];

    expect(resolveGroupedDragLayout(next, before, "a", ["a", "b"], { columns: 24, maxRows: 12 })).toBeNull();
  });

  test("rejects grouped moves outside the row budget", () => {
    const before = [
      { i: "a", x: 0, y: 0, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 6, h: 6 },
    ];
    const next = [
      { i: "a", x: 0, y: 7, w: 6, h: 6 },
      { i: "b", x: 6, y: 0, w: 6, h: 6 },
    ];

    expect(resolveGroupedDragLayout(next, before, "a", ["a", "b"], { columns: 24, maxRows: 12 })).toBeNull();
  });
});

describe("row-tiling widths", () => {
  test("keeps a lone flex tile at its row-tiling width", () => {
    const packed = mergeLayout([], 
      [{ id: "note", preferredSpan: 8, preferredRows: 5 }],
      OPTS,
    );
    expect(packed[0]?.w).toBe(8);
  });
  test("does not stretch aspect-locked tiles past their row-tiling cap", () => {
    const packed = mergeLayout([], 
      [{ id: "tweet", aspect: 1.2, maxWidthPx: 550, minSpan: 4 }],
      OPTS,
    );
    const span = defined(packed[0]).w;
    const px = span * ((OPTS.containerWidth - OPTS.gap * (OPTS.columns - 1)) / OPTS.columns) + OPTS.gap * (span - 1);
    expect(px).toBeLessThanOrEqual(550);
  });
  test("keeps mixed rows on the same tiling span", () => {
    const packed = mergeLayout([], 
      [
        { id: "tweet", aspect: 1.2, maxWidthPx: 550, minSpan: 4 },
        { id: "note", preferredSpan: 8, preferredRows: 6 },
      ],
      OPTS,
    );
    const tweet = defined(packed.find((l) => l.i === "tweet"));
    const note = defined(packed.find((l) => l.i === "note"));
    expect(tweet.y).toBe(0);
    expect(note.y).toBe(0);
    expect(tweet.w).toBe(8);
    expect(note.w).toBe(8);
  });
});

describe("regression — tweet placement realism", () => {
  test("a 1.2-aspect tweet on a typical laptop viewport lands near its 550px natural width", () => {
    const spec: TileSpec = {
      aspect: 1.2,
      maxWidthPx: 550,
      minSpan: 4,
      preferredRows: 16,
    };
    const span = chooseSpan(spec, OPTS);
    const pxW = colSpanToPx(span, OPTS);
    expect(pxW).toBeGreaterThan(460);
    expect(pxW).toBeLessThanOrEqual(550);
  });
  test("narrow lg viewport doesn't give tweet a sub-4-col span", () => {
    const narrow = { ...OPTS, containerWidth: 768 };
    const spec: TileSpec = { aspect: 1.5, maxWidthPx: 550, minSpan: 4 };
    expect(chooseSpan(spec, narrow)).toBeGreaterThanOrEqual(4);
  });
});
