import { nanoid } from "nanoid";
import { mergeLayout } from "@/components/ui/auto-canvas";
import {
  LG_COLS,
  MARGIN,
  ROW_HEIGHT,
  buildSpecList,
  estimateContainerWidth,
} from "@/lib/tile-specs";
import {
  isDraftImageItem,
  type BoardPage,
  type Canvas as SharedCanvasData,
  type CanvasItem,
  type GridLayouts,
} from "@/lib/types";

interface PreviewUrlAdapter {
  create(file: File): string;
  revoke(url: string): void;
}

const browserPreviewUrlAdapter: PreviewUrlAdapter = {
  create(file) {
    return URL.createObjectURL(file);
  },
  revoke(url) {
    URL.revokeObjectURL(url);
  },
};

export function emptyBoardPage(): BoardPage {
  return { id: nanoid(8), items: [], layouts: { lg: [], sm: [] } };
}

export function pruneEmptyPages(pages: BoardPage[]): BoardPage[] {
  const nonEmpty = pages.filter((page) => page.items.length > 0);
  return nonEmpty.length > 0 ? nonEmpty : [emptyBoardPage()];
}

export function packPageLayouts(items: CanvasItem[], prev: GridLayouts, maxRows: number): GridLayouts {
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

export function editorPagesFromCanvas(canvas: SharedCanvasData): BoardPage[] {
  if (canvas.pages.length === 0) return [emptyBoardPage()];
  return canvas.pages.map((page) => ({
    id: page.id || nanoid(8),
    items: page.items,
    layouts: page.layouts ?? { lg: [], sm: [] },
  }));
}

function draftPreviewUrlsOnPage(page: BoardPage): string[] {
  const urls: string[] = [];
  for (const item of page.items) {
    if (isDraftImageItem(item)) urls.push(item.previewUrl);
  }
  return urls;
}

function removeItemsFromPageState(page: BoardPage, ids: ReadonlySet<string>): BoardPage {
  if (ids.size === 0) return page;
  return {
    ...page,
    items: page.items.filter((item) => !ids.has(item.id)),
    layouts: {
      lg: page.layouts.lg.filter((layout) => !ids.has(layout.i)),
      sm: page.layouts.sm.filter((layout) => !ids.has(layout.i)),
    },
  };
}

function previewUrlsForRemovedItems(page: BoardPage, ids: ReadonlySet<string>): string[] {
  if (ids.size === 0) return [];
  const urls: string[] = [];
  for (const item of page.items) {
    if (ids.has(item.id) && isDraftImageItem(item)) urls.push(item.previewUrl);
  }
  return urls;
}

export function revokeDraftImagePreviews(
  pages: readonly BoardPage[],
  adapter: PreviewUrlAdapter = browserPreviewUrlAdapter,
) {
  for (const page of pages) {
    for (const url of draftPreviewUrlsOnPage(page)) adapter.revoke(url);
  }
}

export function removeItemsFromPage(
  page: BoardPage,
  ids: ReadonlySet<string>,
  adapter: PreviewUrlAdapter = browserPreviewUrlAdapter,
): BoardPage {
  for (const url of previewUrlsForRemovedItems(page, ids)) adapter.revoke(url);
  return removeItemsFromPageState(page, ids);
}

export function duplicateItemWithSpillToPages({
  pages,
  activePage,
  id,
  maxRows,
  adapter = browserPreviewUrlAdapter,
}: {
  pages: BoardPage[];
  activePage: number;
  id: string;
  maxRows: number;
  adapter?: PreviewUrlAdapter;
}): { pages: BoardPage[]; landedIndex: number; newId: string } | null {
  const source = pages[activePage]?.items.find((item) => item.id === id);
  if (!source) return null;
  const newId = nanoid(10);
  const copy = isDraftImageItem(source)
    ? { ...source, id: newId, previewUrl: adapter.create(source.file) }
    : { ...source, id: newId };
  // Every duplicate keeps the source tile's current size — a user who resized
  // a card expects its copy to match, whatever the item type.
  const exact = addDuplicateAtSourceSize({ pages, activePage, sourceId: id, item: copy, maxRows });
  if (exact) return { ...exact, newId };
  const result = addItemWithSpillToPages({ pages, activePage, item: copy, maxRows });
  return { ...result, newId };
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
  item: CanvasItem;
  maxRows: number;
}): { pages: BoardPage[]; landedIndex: number } | null {
  const active = pages[activePage];
  const activeLayouts = active ? packPageLayouts(active.items, active.layouts, maxRows) : null;
  const sourceLayout = activeLayouts?.lg.find((layout) => layout.i === sourceId);
  if (!active || !sourceLayout) return null;

  const slot = firstOpenSlot(activeLayouts.lg, sourceLayout.w, sourceLayout.h, LG_COLS, maxRows);
  if (!slot) return null;
  const candidate = {
    ...sourceLayout,
    i: item.id,
    x: slot.x,
    y: slot.y,
    w: sourceLayout.w,
    h: sourceLayout.h,
  };

  const items = [...active.items, item];
  const layouts = packPageLayouts(
    items,
    { ...activeLayouts, lg: [...activeLayouts.lg, candidate] },
    maxRows,
  );
  const bottom = layoutBottom(layouts.lg);
  if (bottom > maxRows) return null;

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

function rectsOverlap(
  a: Pick<GridLayouts["lg"][number], "x" | "y" | "w" | "h">,
  b: Pick<GridLayouts["lg"][number], "x" | "y" | "w" | "h">,
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function addItemWithSpillToPages({
  pages,
  activePage,
  item,
  maxRows,
}: {
  pages: BoardPage[];
  activePage: number;
  item: CanvasItem;
  maxRows: number;
}): { pages: BoardPage[]; landedIndex: number } {
  const next = [...pages];
  const start = Math.max(0, activePage);

  for (let index = start; index < next.length; index++) {
    const target = next[index] ?? emptyBoardPage();
    const items = [...target.items, item];
    const layouts = packPageLayouts(items, target.layouts, maxRows);
    const bottom = layoutBottom(layouts.lg);
    if (bottom <= maxRows) {
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

  const landedIndex = next.length;
  const target = emptyBoardPage();
  const items = [...target.items, item];
  const layouts = clampSingleItemLayoutsToBudget(
    packPageLayouts(items, target.layouts, maxRows),
    maxRows,
  );
  next[landedIndex] = {
    ...target,
    items,
    layouts,
  };
  return { pages: next, landedIndex };
}

export const __boardLifecyclePolicyForTests = {
  draftPreviewUrlsOnPage,
  previewUrlsForRemovedItems,
  removeItemsFromPageState,
};
