import type { LayoutItem } from "react-grid-layout";
import type { TileSpec } from "./types";

export interface PackOptions {
  /** Grid column count (e.g. 24). */
  columns: number;
  /** Container inner width in pixels. */
  containerWidth: number;
  /** Row height in pixels (react-grid-layout rowHeight). */
  rowHeight: number;
  /** Gap between cells in pixels (react-grid-layout margin, same on both axes). */
  gap: number;
  /** Row budget; if omitted, packer lays out unbounded vertically. */
  maxRows?: number;
}

/**
 * Pixel width for a `span` at the given container width.
 * Mirrors react-grid-layout's column math: N columns and N-1 gaps fill the container.
 */
export function colSpanToPx(span: number, options: PackOptions): number {
  const { columns, containerWidth, gap } = options;
  const colWidth = (containerWidth - gap * (columns - 1)) / columns;
  return colWidth * span + gap * Math.max(0, span - 1);
}

/** Inverse of colSpanToPx — pixel width → closest column span. */
export function pxToColSpan(px: number, options: PackOptions): number {
  const { columns, containerWidth, gap } = options;
  const colWidth = (containerWidth - gap * (columns - 1)) / columns;
  // px = colWidth * span + gap * (span - 1) = span*(colWidth + gap) - gap
  // span = (px + gap) / (colWidth + gap)
  return (px + gap) / (colWidth + gap);
}

/**
 * Convert pixel height to grid rows (matching react-grid-layout's height math:
 * h rows = rowHeight*h + gap*(h-1)).
 */
export function pxToRows(px: number, options: PackOptions): number {
  const { rowHeight, gap } = options;
  return (px + gap) / (rowHeight + gap);
}

/** Inverse of pxToRows. */
export function rowsToPx(rows: number, options: PackOptions): number {
  const { rowHeight, gap } = options;
  return rows * rowHeight + gap * Math.max(0, rows - 1);
}

/**
 * Choose the column span for a spec. Spans are rounded down so N tiles tile the
 * row evenly — otherwise preferredSpan=10 on a 24-col grid gives 2 tiles per row
 * with 4 empty cols on the right. With this rule, preferredSpan=10 → tiles
 * land at span=8 (3 per row, no gap). Aspect-locked tiles with `maxWidthPx`
 * use the same rule with the pixel cap as the upper bound.
 */
export function chooseSpan(spec: TileSpec, options: PackOptions): number {
  const { columns } = options;
  const min = Math.max(1, spec.minSpan ?? 3);

  // Largest span that (a) the caller wants and (b) respects maxWidthPx.
  // e.g. preferredSpan=8 → cap=8; tweet maxWidthPx=550 on a 1300px grid → cap=10.
  let cap: number;
  if (spec.maxWidthPx != null && spec.maxWidthPx > 0) {
    cap = min;
    for (let s = columns; s >= min; s--) {
      if (colSpanToPx(s, options) <= spec.maxWidthPx) { cap = s; break; }
    }
  } else {
    cap = clamp(spec.preferredSpan ?? Math.min(columns, 8), min, columns);
  }

  // Round down to a row-tiling span: tilesPerRow = ceil(columns / cap);
  // span = floor(columns / tilesPerRow). Never exceeds cap, never leaves gaps.
  // e.g. cap=10, cols=24 → tilesPerRow=3 → span=8.
  const tilesPerRow = Math.max(1, Math.ceil(columns / cap));
  return Math.max(min, Math.floor(columns / tilesPerRow));
}

/**
 * Derive grid-row height for a spec given its chosen span. Aspect-locked tiles
 * derive height from span; flex tiles use preferredRows.
 */
export function chooseRows(spec: TileSpec, span: number, options: PackOptions): number {
  const minRows = Math.max(1, spec.minRows ?? 3);
  if (spec.aspect && spec.aspect > 0) {
    const pxW = colSpanToPx(span, options);
    const pxH = pxW / spec.aspect;
    const rows = Math.max(minRows, Math.round(pxToRows(pxH, options)));
    return rows;
  }
  return Math.max(minRows, spec.preferredRows ?? 10);
}

export interface SkylineInput {
  id: string;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
}

/**
 * Skyline (Pinterest-style) masonry packer. Each tile drops into the column
 * position that minimizes y, breaking ties left-to-right. Produces denser
 * packing than row-major without row stripes.
 *
 * Tile order is preserved (no sort) so the result matches insertion order —
 * important for user predictability when adding cards.
 */
export function packSkyline(
  inputs: SkylineInput[],
  options: PackOptions,
): LayoutItem[] {
  const { columns } = options;
  const skyline: number[] = new Array(columns).fill(0);
  const out: LayoutItem[] = [];

  for (const item of inputs) {
    const w = Math.max(1, Math.min(columns, item.w));
    let bestX = 0;
    let bestY = Number.POSITIVE_INFINITY;

    for (let x = 0; x <= columns - w; x++) {
      let y = 0;
      for (let k = 0; k < w; k++) y = Math.max(y, skyline[x + k]);
      if (y < bestY) {
        bestY = y;
        bestX = x;
      }
    }
    if (!Number.isFinite(bestY)) bestY = 0;

    const y = bestY;
    const h = Math.max(1, item.h);
    for (let k = 0; k < w; k++) skyline[bestX + k] = y + h;

    // Clamp minH to the tile's actual h. If emergency scale-down has shrunk
    // this tile below its spec's minRows, we don't want react-grid-layout to
    // snap it up to minH on the first nudge of the resize handle — that
    // feels like the card "jumps" into a larger size before the user has
    // actually resized it. Users can still grow the tile by dragging outward;
    // this just removes the involuntary upward jump at resize-start.
    const effectiveMinH = item.minH != null ? Math.min(item.minH, h) : undefined;
    const effectiveMinW = item.minW != null ? Math.min(item.minW, w) : undefined;

    out.push({
      i: item.id,
      x: bestX,
      y,
      w,
      h,
      ...(effectiveMinW != null && { minW: effectiveMinW }),
      ...(effectiveMinH != null && { minH: effectiveMinH }),
      ...(item.maxW != null && { maxW: item.maxW }),
    });
  }

  return out;
}

/**
 * Generate a full layout from tile specs. Each spec picks its own span/rows
 * based on aspect/maxWidthPx/preferences, then a skyline packer places them
 * in insertion order.
 *
 * If `maxRows` is given and the packed layout would overflow, row heights are
 * scaled down uniformly until the layout fits (with minH floors respected).
 */
export function packLayout(
  specs: Array<{ id: string } & TileSpec>,
  options: PackOptions,
): LayoutItem[] {
  const inputs = specs.map((spec) => {
    const w = chooseSpan(spec, options);
    const h = chooseRows(spec, w, options);
    return {
      id: spec.id,
      w,
      h,
      minW: spec.minSpan ?? 3,
      minH: spec.minRows ?? 3,
    };
  });

  const packed = packSkyline(inputs, options);
  if (!options.maxRows || options.maxRows <= 0) return packed;

  const fits = (result: LayoutItem[]) =>
    result.every((l) => l.y + l.h <= options.maxRows!);
  if (fits(packed)) return packed;

  // Scale heights proportionally but respect each spec's minRows floor — if
  // the budget is only slightly too tight, this can nudge things into place
  // without shrinking tiles into unreadable slivers.
  const bottom = packed.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  const scale = options.maxRows / bottom;
  const shrunk = inputs.map((inp, i) => ({
    ...inp,
    h: Math.max(specs[i].minRows ?? 3, Math.floor(inp.h * scale)),
  }));
  const shrunkPacked = packSkyline(shrunk, options);
  if (fits(shrunkPacked)) return shrunkPacked;

  // Budget is genuinely too tight to fit everything even at minRows. Rather
  // than crushing tiles below minRows (unreadable), keep them at minRows and
  // let the canvas scroll. This matches the "infinitely scalable canvas"
  // model: tiles stay legible; the user scrolls to reach overflow content.
  return shrunkPacked;
}

/**
 * Merge a persisted layout with fresh packing: known tile ids keep their
 * positions; new ids get packed into the empty space. If the persisted layout
 * is empty, this is equivalent to packLayout.
 */
export function mergeLayout(
  persisted: LayoutItem[],
  specs: Array<{ id: string } & TileSpec>,
  options: PackOptions,
): LayoutItem[] {
  const persistedById = new Map(persisted.map((l) => [l.i, l]));
  const specById = new Map(specs.map((s) => [s.id, s]));

  const kept: LayoutItem[] = [];
  const skyline: number[] = new Array(options.columns).fill(0);

  // Keep persisted positions for tiles that still exist, and seed the skyline
  // with their footprint so new tiles tuck around them rather than colliding.
  for (const spec of specs) {
    const p = persistedById.get(spec.id);
    if (!p) continue;
    kept.push(p);
    for (let k = 0; k < p.w; k++) {
      const col = p.x + k;
      if (col >= 0 && col < options.columns) {
        skyline[col] = Math.max(skyline[col], p.y + p.h);
      }
    }
  }

  // Pack new (non-persisted) tiles into the remaining space.
  const fresh: SkylineInput[] = [];
  for (const spec of specs) {
    if (persistedById.has(spec.id)) continue;
    const w = chooseSpan(spec, options);
    const h = chooseRows(spec, w, options);
    fresh.push({ id: spec.id, w, h, minW: spec.minSpan ?? 3, minH: spec.minRows ?? 3 });
  }

  for (const item of fresh) {
    const w = Math.max(1, Math.min(options.columns, item.w));
    let bestX = 0;
    let bestY = Number.POSITIVE_INFINITY;
    for (let x = 0; x <= options.columns - w; x++) {
      let y = 0;
      for (let k = 0; k < w; k++) y = Math.max(y, skyline[x + k]);
      if (y < bestY) {
        bestY = y;
        bestX = x;
      }
    }
    if (!Number.isFinite(bestY)) bestY = 0;

    const y = bestY;
    for (let k = 0; k < w; k++) skyline[bestX + k] = y + item.h;

    kept.push({
      i: item.id,
      x: bestX,
      y,
      w,
      h: item.h,
      ...(item.minW != null && { minW: Math.min(item.minW, w) }),
      ...(item.minH != null && { minH: Math.min(item.minH, item.h) }),
    });
  }

  // Drop any persisted positions for specs that no longer exist.
  const final = kept.filter((l) => specById.has(l.i));

  // If the merged layout overflows the row budget, the persisted arrangement
  // can't accommodate the new set of tiles. Re-pack from scratch so content
  // stays inside the viewport — users may lose custom positions, but they'll
  // never see cards clipped off-screen by the canvas's overflow-hidden.
  if (options.maxRows && options.maxRows > 0) {
    const bottom = final.reduce((m, l) => Math.max(m, l.y + l.h), 0);
    if (bottom > options.maxRows) {
      return packLayout(specs, options);
    }
  }

  return final;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
