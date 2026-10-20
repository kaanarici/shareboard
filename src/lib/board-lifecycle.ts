import { nanoid } from "nanoid";
import { mergeLayout, rectsOverlap } from "@/lib/auto-canvas/pack";
import {
  LG_COLS,
  MARGIN,
  ROW_HEIGHT,
  buildSpecList,
  estimateContainerWidth,
} from "@/lib/tile-specs";
import {
  emptyLayouts,
  isDraftImageItem,
  type BoardPage,
  type Board,
  type BoardItem,
  type GridLayouts,
} from "@/lib/types";

export function emptyBoardPage(): BoardPage {
  return { id: nanoid(8), items: [], layouts: emptyLayouts() };
}

export function packedPage(items: BoardItem[], maxRows: number): BoardPage {
  return { id: nanoid(8), items, layouts: packPageLayouts(items, emptyLayouts(), maxRows) };
}

export function pruneEmptyPages(pages: BoardPage[]): BoardPage[] {
  const nonEmpty = pages.filter((page) => page.items.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : [emptyBoardPage()];
}

function packPageLayouts(items: BoardItem[], prev: GridLayouts, maxRows: number): GridLayouts {
  const specs = buildSpecList(items);
  const containerWidth = estimateContainerWidth();
  return {
    lg: mergeLayout(prev.lg, specs, {
      columns: LG_COLS,
      containerWidth,
      rowHeight: ROW_HEIGHT,
      gap: MARGIN,
      maxRows,
    }),
    sm: mergeLayout(prev.sm, specs, {
      columns: 1,
      containerWidth,
      rowHeight: ROW_HEIGHT,
      gap: MARGIN,
    }),
  };
}

function layoutBottom(layouts: GridLayouts["lg"]): number {
  return layouts.reduce((max, layout) => Math.max(max, layout.y + layout.h), 0);
}

function clampSingleItemLayoutsToBudget(layouts: GridLayouts, maxRows: number): GridLayouts {
  if (maxRows <= 0 || layouts.lg.length !== 1) return layouts;
  const lg = layouts.lg.map((layout) => {
    const y = Math.max(0, Math.min(layout.y, maxRows - 1));
    const h = Math.max(1, Math.min(layout.h, maxRows - y));
    return {
      ...layout,
      y,
      h,
      ...(layout.minH != null && { minH: Math.min(layout.minH, h) }),
    };
  });
  return { ...layouts, lg };
}

export function pagesFromBoard(board: Board): BoardPage[] {
  if (board.pages.length === 0) return [emptyBoardPage()];
  return board.pages.map((page) => ({ id: page.id || nanoid(8), items: page.items, layouts: page.layouts }));
}

export function layoutsForItems(layouts: GridLayouts, items: readonly { id: string }[]): GridLayouts {
  const ids = new Set(items.map((item) => item.id));
  return {
    lg: layouts.lg.filter((layout) => ids.has(layout.i)),
    sm: layouts.sm.filter((layout) => ids.has(layout.i)),
  };
}

function draftPreviewUrls(pages: readonly BoardPage[]): Set<string> {
  const urls = new Set<string>();
  for (const page of pages) {
    for (const item of page.items) {
      if (isDraftImageItem(item)) urls.add(item.previewUrl);
    }
  }
  return urls;
}

export function revokeItemPreviews(items: readonly BoardItem[]) {
  for (const item of items) {
    if (isDraftImageItem(item)) URL.revokeObjectURL(item.previewUrl);
  }
}

export function revokeDraftImagePreviews(pages: readonly BoardPage[]) {
  for (const url of draftPreviewUrls(pages)) URL.revokeObjectURL(url);
}

export function revokeRemovedPreviews(previous: readonly BoardPage[], next: readonly BoardPage[]) {
  const kept = draftPreviewUrls(next);
  for (const url of draftPreviewUrls(previous)) {
    if (!kept.has(url)) URL.revokeObjectURL(url);
  }
}

export function withFreshPreviews(pages: readonly BoardPage[]): BoardPage[] {
  return pages.map((page) => ({
    ...page,
    items: page.items.map((item) =>
      isDraftImageItem(item) ? { ...item, previewUrl: URL.createObjectURL(item.file) } : item,
    ),
  }));
}

export function copyBoardItem(item: BoardItem): BoardItem {
  const id = nanoid(10);
  return isDraftImageItem(item) ? { ...item, id, previewUrl: URL.createObjectURL(item.file) } : { ...item, id };
}

export function removeItemsFromPage(page: BoardPage, ids: ReadonlySet<string>): BoardPage {
  if (ids.size === 0) return page;
  const items = page.items.filter((item) => !ids.has(item.id));
  return { ...page, items, layouts: layoutsForItems(page.layouts, items) };
}

export function duplicateItemWithSpillToPages({
  pages,
  activePage,
  sourceId,
  copy,
  maxRows,
}: {
  pages: BoardPage[];
  activePage: number;
  sourceId: string;
  copy: BoardItem;
  maxRows: number;
}): SpillResult {
  return (
    addDuplicateAtSourceSize({ pages, activePage, sourceId, item: copy, maxRows }) ??
    addItemWithSpillToPages({ pages, activePage, item: copy, maxRows })
  );
}

function addDuplicateAtSourceSize({
  pages,
  activePage,
  sourceId,
  item,
  maxRows,
}: {
  pages: BoardPage[];
  activePage: number;
  sourceId: string;
  item: BoardItem;
  maxRows: number;
}): SpillResult | null {
  const active = pages[activePage];
  const activeLayouts = active ? packPageLayouts(active.items, active.layouts, maxRows) : null;
  const sourceLayout = activeLayouts?.lg.find((layout) => layout.i === sourceId);
  if (!active || !activeLayouts || !sourceLayout) return null;

  const slot = firstOpenSlot(activeLayouts.lg, sourceLayout.w, sourceLayout.h, LG_COLS, maxRows);
  if (!slot) return null;
  const candidate = { ...sourceLayout, i: item.id, x: slot.x, y: slot.y };

  const items = [...active.items, item];
  const layouts = packPageLayouts(
    items,
    { ...activeLayouts, lg: [...activeLayouts.lg, candidate] },
    maxRows,
  );
  if (layoutBottom(layouts.lg) > maxRows) return null;

  const next = [...pages];
  next[activePage] = { ...active, items, layouts };
  return { pages: next, landedIndex: activePage };
}

function firstOpenSlot(
  layouts: GridLayouts["lg"],
  width: number,
  height: number,
  columns: number,
  maxRows: number,
): { x: number; y: number } | null {
  const w = Math.max(1, Math.min(columns, width));
  const h = Math.max(1, Math.min(maxRows, height));
  const maxY = Math.max(0, maxRows - h);
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= columns - w; x++) {
      const candidate = { x, y, w, h };
      if (layouts.every((layout) => !rectsOverlap(candidate, layout))) return { x, y };
    }
  }
  return null;
}

type SpillResult = { pages: BoardPage[]; landedIndex: number };

export function placeItemsWithSpill({
  pages,
  activePage,
  items,
  maxRows,
}: {
  pages: BoardPage[];
  activePage: number;
  items: readonly BoardItem[];
  maxRows: number;
}): SpillResult & { selectedIds: string[] } {
  let result: SpillResult = { pages, landedIndex: activePage };
  const idsByPage = new Map<number, string[]>();
  for (const item of items) {
    result = addItemWithSpillToPages({ pages: result.pages, activePage: result.landedIndex, item, maxRows });
    idsByPage.set(result.landedIndex, [...(idsByPage.get(result.landedIndex) ?? []), item.id]);
  }
  return { ...result, selectedIds: idsByPage.get(result.landedIndex) ?? [] };
}

export function addItemWithSpillToPages({
  pages,
  activePage,
  item,
  maxRows,
}: {
  pages: BoardPage[];
  activePage: number;
  item: BoardItem;
  maxRows: number;
}): SpillResult {
  const next = [...pages];
  const start = Math.max(0, activePage);

  for (let index = start; index < next.length; index++) {
    const target = next[index] ?? emptyBoardPage();
    const items = [...target.items, item];
    const layouts = packPageLayouts(items, target.layouts, maxRows);
    if (layoutBottom(layouts.lg) <= maxRows) {
      next[index] = { ...target, items, layouts };
      return { pages: next, landedIndex: index };
    }
    if (target.items.length === 0) {
      const clamped = clampSingleItemLayoutsToBudget(layouts, maxRows);
      if (layoutBottom(clamped.lg) <= maxRows) {
        next[index] = { ...target, items, layouts: clamped };
        return { pages: next, landedIndex: index };
      }
    }
  }

  const target = emptyBoardPage();
  const layouts = clampSingleItemLayoutsToBudget(packPageLayouts([item], target.layouts, maxRows), maxRows);
  next.push({ ...target, items: [item], layouts });
  return { pages: next, landedIndex: next.length - 1 };
}

