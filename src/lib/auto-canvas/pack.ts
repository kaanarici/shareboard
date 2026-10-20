import type { LayoutItem } from "react-grid-layout";
import type { TileSpec } from "./types";

export interface PackOptions {
  columns: number;
  containerWidth: number;
  rowHeight: number;
  gap: number;
  maxRows?: number;
}

export interface ResolveDisplacementOptions {
  columns: number;
  maxRows?: number;
}

export function colSpanToPx(span: number, options: PackOptions): number {
  const { columns, containerWidth, gap } = options;
  const colWidth = (containerWidth - gap * (columns - 1)) / columns;
  return colWidth * span + gap * Math.max(0, span - 1);
}

export function pxToRows(px: number, options: PackOptions): number {
  const { rowHeight, gap } = options;
  return (px + gap) / (rowHeight + gap);
}

export function chooseSpan(spec: TileSpec, options: PackOptions): number {
  const { columns } = options;
  const min = Math.max(1, spec.minSpan ?? 3);

  let cap: number;
  if (spec.maxWidthPx != null && spec.maxWidthPx > 0) {
    cap = min;
    for (let s = columns; s >= min; s--) {
      if (colSpanToPx(s, options) <= spec.maxWidthPx) { cap = s; break; }
    }
  } else {
    cap = clamp(spec.preferredSpan ?? Math.min(columns, 8), min, columns);
  }

  const tilesPerRow = Math.max(1, Math.ceil(columns / cap));
  return Math.max(min, Math.floor(columns / tilesPerRow));
}

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

export function mergeLayout(
  persisted: LayoutItem[],
  specs: Array<{ id: string } & TileSpec>,
  options: PackOptions,
): LayoutItem[] {
  const persistedById = new Map<string, LayoutItem>();
  for (const item of persisted) {
    const normalized = normalizeLayoutItem(item, options);
    if (normalized) persistedById.set(normalized.i, normalized);
  }

  const kept: LayoutItem[] = [];
  const keptIds = new Set<string>();
  const skyline: number[] = new Array(options.columns).fill(0);

  for (const spec of specs) {
    const p = persistedById.get(spec.id);
    if (!p) continue;
    const renderedH =
      spec.aspect && spec.aspect > 0
        ? chooseRows(spec, p.w, options)
        : p.h;
    const item = renderedH === p.h ? p : { ...p, h: renderedH };
    if (options.maxRows && options.maxRows > 0 && item.y + item.h > options.maxRows) continue;
    if (kept.some((existing) => rectsOverlap(existing, item))) continue;
    kept.push(item);
    keptIds.add(item.i);
    for (let k = 0; k < item.w; k++) {
      const col = item.x + k;
      if (col >= 0 && col < options.columns) {
        skyline[col] = Math.max(skyline[col] ?? 0, item.y + item.h);
      }
    }
  }

  for (const spec of specs) {
    if (keptIds.has(spec.id)) continue;
    const placement = placeFresh(spec, kept, skyline, options);

    for (let k = 0; k < placement.w; k++) {
      skyline[placement.x + k] = placement.y + placement.h;
    }

    kept.push({
      i: spec.id,
      x: placement.x,
      y: placement.y,
      w: placement.w,
      h: placement.h,
      ...(spec.minSpan != null && { minW: Math.min(spec.minSpan, placement.w) }),
      ...(spec.minRows != null && { minH: Math.min(spec.minRows, placement.h) }),
    });
  }

  return kept;
}

export function normalizeLayoutItem(
  item: LayoutItem,
  options: Pick<PackOptions, "columns" | "maxRows">,
): LayoutItem | null {
  if (!item.i) return null;
  const xValue = Number(item.x);
  const yValue = Number(item.y);
  const wValue = Number(item.w);
  const hValue = Number(item.h);
  if (![xValue, yValue, wValue, hValue].every(Number.isFinite)) return null;

  const w = Math.max(1, Math.min(options.columns, Math.floor(wValue)));
  const maxX = Math.max(0, options.columns - w);
  const maxRows = options.maxRows && options.maxRows > 0 ? Math.floor(options.maxRows) : null;
  const h = Math.max(1, Math.min(maxRows ?? Number.POSITIVE_INFINITY, Math.floor(hValue)));
  const maxY = maxRows ? Math.max(0, maxRows - h) : Number.POSITIVE_INFINITY;
  const minW = Number(item.minW);
  const maxW = Number(item.maxW);
  const minH = Number(item.minH);
  const maxH = Number(item.maxH);
  return {
    i: item.i,
    x: Math.max(0, Math.min(maxX, Math.floor(xValue))),
    y: Math.max(0, Math.min(maxY, Math.floor(yValue))),
    w,
    h,
    ...(Number.isFinite(minW) && { minW: Math.min(minW, w) }),
    ...(Number.isFinite(maxW) && { maxW: Math.max(maxW, w) }),
    ...(Number.isFinite(minH) && { minH: Math.min(minH, h) }),
    ...(Number.isFinite(maxH) && { maxH: Math.max(maxH, h) }),
  };
}

export function rectsOverlap(
  a: Pick<LayoutItem, "x" | "y" | "w" | "h">,
  b: Pick<LayoutItem, "x" | "y" | "w" | "h">,
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function resolveDisplacedLayout(
  next: readonly LayoutItem[],
  before: readonly LayoutItem[],
  movedId: string,
  options: ResolveDisplacementOptions,
): LayoutItem[] | null {
  const moved = next.find((item) => item.i === movedId);
  const prevMoved = before.find((item) => item.i === movedId);
  if (!moved || !prevMoved || !fitsBounds(moved, options)) return null;

  const inserted = resolveInsertedLayout(next, before, moved, options);
  if (inserted) return inserted;

  const result = next.map((item) => ({ ...item }));
  const queue = result
    .filter((item) => item.i !== movedId && rectsOverlap(item, moved))
    .map((item) => item.i);
  const maxSteps = Math.max(1, result.length * result.length);
  let steps = 0;

  for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
    if (steps++ > maxSteps) return null;
    const item = result.find((entry) => entry.i === id);
    if (!item || !result.some((entry) => entry.i !== id && rectsOverlap(entry, item))) continue;

    const directPosition = findDirectDisplacedPosition({
      item,
      layouts: result,
      moved,
      prevMoved,
      options,
    });
    const position = directPosition
      ?? findCascadePushPosition(item, result, moved, prevMoved, options)
      ?? nearestOpenPosition(item, result, options);
    if (!position) return null;
    item.x = position.x;
    item.y = position.y;

    for (const collision of result) {
      if (collision.i !== item.i && collision.i !== movedId && rectsOverlap(collision, item)) {
        queue.push(collision.i);
      }
    }
  }

  return layoutIsValid(result, options) ? result : null;
}

export function resolveGroupedDragLayout(
  next: readonly LayoutItem[],
  before: readonly LayoutItem[],
  movedId: string,
  selectedIds: readonly string[] | undefined,
  options: ResolveDisplacementOptions,
): LayoutItem[] | null {
  const selected = new Set(selectedIds ?? []);
  if (selected.size < 2 || !selected.has(movedId)) return null;

  const moved = next.find((item) => item.i === movedId);
  const prevMoved = before.find((item) => item.i === movedId);
  if (!moved || !prevMoved) return null;

  const dx = moved.x - prevMoved.x;
  const dy = moved.y - prevMoved.y;
  if (dx === 0 && dy === 0) return null;

  const result = before.map((item) =>
    selected.has(item.i)
      ? { ...item, x: item.x + dx, y: item.y + dy }
      : { ...item },
  );

  return layoutIsValid(result, options) ? result : null;
}

function resolveInsertedLayout(
  next: readonly LayoutItem[],
  before: readonly LayoutItem[],
  moved: LayoutItem,
  options: ResolveDisplacementOptions,
): LayoutItem[] | null {
  const target = before
    .filter((item) => item.i !== moved.i && rectsOverlap(item, moved))
    .map((item) => ({
      item,
      ratio: overlapArea(item, moved) / Math.max(1, Math.min(item.w * item.h, moved.w * moved.h)),
    }))
    .sort((a, b) => b.ratio - a.ratio)[0];
  if (!target || target.ratio < 0.55) return null;

  const prevMoved = before.find((item) => item.i === moved.i);
  if (!prevMoved) return null;
  if (target.item.y !== prevMoved.y) return swapWithTarget(next, before, moved, prevMoved, target.item, options);

  const nextIds = new Set(next.map((item) => item.i));
  const beforeOrdered = before
    .filter((item) => nextIds.has(item.i))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const fromIndex = beforeOrdered.findIndex((item) => item.i === moved.i);
  const toIndex = beforeOrdered.findIndex((item) => item.i === target.item.i);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  const path = beforeOrdered.slice(start, end + 1);
  if (path.some((item) => item.w !== moved.w || item.h !== moved.h)) return null;

  const orderedIds = beforeOrdered.map((item) => item.i);
  orderedIds.splice(fromIndex, 1);
  orderedIds.splice(toIndex, 0, moved.i);

  const result = next.map((item) => ({ ...item }));
  for (let index = 0; index < beforeOrdered.length; index++) {
    const item = result.find((entry) => entry.i === orderedIds[index]);
    const slot = beforeOrdered[index];
    if (!item || !slot) return null;
    item.x = slot.x;
    item.y = slot.y;
  }

  return layoutIsValid(result, options) ? result : null;
}

function swapWithTarget(
  next: readonly LayoutItem[],
  before: readonly LayoutItem[],
  moved: LayoutItem,
  prevMoved: LayoutItem,
  target: LayoutItem,
  options: ResolveDisplacementOptions,
): LayoutItem[] | null {
  if (target.w !== moved.w || target.h !== moved.h) return null;
  const result = next.map((item) => {
    if (item.i === moved.i) return { ...item, x: target.x, y: target.y };
    if (item.i === target.i) return { ...item, x: prevMoved.x, y: prevMoved.y };
    const original = before.find((entry) => entry.i === item.i);
    return original ? { ...item, x: original.x, y: original.y } : { ...item };
  });
  return layoutIsValid(result, options) ? result : null;
}

function findDirectDisplacedPosition({
  item,
  layouts,
  moved,
  prevMoved,
  options,
}: {
  item: LayoutItem;
  layouts: LayoutItem[];
  moved: LayoutItem;
  prevMoved: LayoutItem;
  options: ResolveDisplacementOptions;
}): { x: number; y: number } | null {
  const dx = moved.x - prevMoved.x;
  const dy = moved.y - prevMoved.y;
  const push =
    Math.abs(dx) >= Math.abs(dy)
      ? { x: dx >= 0 ? moved.x + moved.w : moved.x - item.w, y: item.y }
      : { x: item.x, y: dy >= 0 ? moved.y + moved.h : moved.y - item.h };
  const vacated = { x: prevMoved.x, y: prevMoved.y };
  const swapFirst = overlapArea(item, moved) / Math.max(1, item.w * item.h) > 0.65;
  const preferred = swapFirst ? [vacated, push] : [push, vacated];

  for (const position of preferred) {
    if (positionFits(item, position, layouts, options)) return position;
  }

  return null;
}

function findCascadePushPosition(
  item: LayoutItem,
  layouts: LayoutItem[],
  moved: LayoutItem,
  prevMoved: LayoutItem,
  options: ResolveDisplacementOptions,
): { x: number; y: number } | null {
  const dx = moved.x - prevMoved.x;
  const dy = moved.y - prevMoved.y;
  const collisions = layouts.filter((entry) => entry.i !== item.i && rectsOverlap(entry, item));
  if (collisions.length === 0) return null;

  const candidate =
    Math.abs(dx) >= Math.abs(dy)
      ? {
          x: dx >= 0
            ? Math.max(...collisions.map((entry) => entry.x + entry.w))
            : Math.min(...collisions.map((entry) => entry.x)) - item.w,
          y: item.y,
        }
      : {
          x: item.x,
          y: dy >= 0
            ? Math.max(...collisions.map((entry) => entry.y + entry.h))
            : Math.min(...collisions.map((entry) => entry.y)) - item.h,
        };

  if (candidate.x === item.x && candidate.y === item.y) return null;
  return fitsBounds({ ...item, ...candidate }, options) ? candidate : null;
}

function nearestOpenPosition(
  item: LayoutItem,
  layouts: LayoutItem[],
  options: ResolveDisplacementOptions,
): { x: number; y: number } | null {
  const maxY = maxAllowedY(item, options);
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= options.columns - item.w; x++) {
      const position = { x, y };
      if (!positionFits(item, position, layouts, options)) continue;
      const score = Math.abs(x - item.x) + Math.abs(y - item.y) * options.columns;
      if (!best || score < best.score) best = { x, y, score };
    }
  }
  return best && { x: best.x, y: best.y };
}

function positionFits(
  item: LayoutItem,
  position: { x: number; y: number },
  layouts: LayoutItem[],
  options: ResolveDisplacementOptions,
) {
  const candidate = { ...item, ...position };
  return (
    fitsBounds(candidate, options) &&
    layouts.every((entry) => entry.i === item.i || !rectsOverlap(candidate, entry))
  );
}

function fitsBounds(item: Pick<LayoutItem, "x" | "y" | "w" | "h">, options: ResolveDisplacementOptions) {
  return (
    item.x >= 0 &&
    item.y >= 0 &&
    item.w > 0 &&
    item.h > 0 &&
    item.x + item.w <= options.columns &&
    (!options.maxRows || options.maxRows <= 0 || item.y + item.h <= options.maxRows)
  );
}

function maxAllowedY(item: LayoutItem, options: ResolveDisplacementOptions) {
  if (options.maxRows && options.maxRows > 0) return Math.max(0, options.maxRows - item.h);
  return Math.max(0, item.y + item.h + 20);
}

function layoutIsValid(layouts: LayoutItem[], options: ResolveDisplacementOptions) {
  return layouts.every((item, index) => (
    fitsBounds(item, options) &&
    layouts.every((other, otherIndex) => index === otherIndex || !rectsOverlap(item, other))
  ));
}

function overlapArea(a: LayoutItem, b: LayoutItem) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

type SkylinePlacement = { x: number; y: number };
type SizedPlacement = SkylinePlacement & { w: number; h: number };

function lowestPlacement(
  skyline: number[],
  w: number,
  columns: number,
): SkylinePlacement {
  let bestX = 0;
  let bestY = Number.POSITIVE_INFINITY;
  const span = Math.max(1, Math.min(columns, w));
  for (let x = 0; x <= columns - span; x++) {
    let y = 0;
    for (let k = 0; k < span; k++) y = Math.max(y, skyline[x + k] ?? 0);
    if (y < bestY) {
      bestY = y;
      bestX = x;
    }
  }
  if (!Number.isFinite(bestY)) bestY = 0;
  return { x: bestX, y: bestY };
}

function placeFresh(
  spec: { id: string } & TileSpec,
  layouts: LayoutItem[],
  skyline: number[],
  options: PackOptions,
): SizedPlacement {
  const { columns, maxRows } = options;
  const preferredSpan = chooseSpan(spec, options);

  if (spec.aspect && spec.aspect > 0 && maxRows && maxRows > 0) {
    const minSpan = Math.max(1, spec.minSpan ?? 1);
    for (let w = preferredSpan; w >= minSpan; w--) {
      const h = chooseRows(spec, w, options);
      const open = firstOpenPosition({ w, h }, layouts, options);
      if (open) return { ...open, w, h };
    }
    const w = minSpan;
    const h = chooseRows(spec, w, options);
    const { x, y } = lowestPlacement(skyline, w, columns);
    return { x, y, w, h };
  }

  const w = preferredSpan;
  const h = chooseRows(spec, w, options);
  const open = firstOpenPosition({ w, h }, layouts, options);
  if (open) return { ...open, w, h };
  const { x, y } = lowestPlacement(skyline, w, columns);
  return { x, y, w, h };
}

function firstOpenPosition(
  size: Pick<LayoutItem, "w" | "h">,
  layouts: LayoutItem[],
  options: ResolveDisplacementOptions,
): { x: number; y: number } | null {
  const item = { i: "__fresh__", x: 0, y: 0, w: Math.max(1, size.w), h: Math.max(1, size.h) };
  const maxY = maxAllowedY(item, options);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= options.columns - item.w; x++) {
      if (positionFits(item, { x, y }, layouts, options)) return { x, y };
    }
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
