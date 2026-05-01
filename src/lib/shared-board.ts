import { sanitizePublicCanvasManifest } from "@/lib/canvas-sanitize";
import {
  BOARD_SUMMARY_ITEM_ID,
  isLockedCanvasStub,
  type Canvas,
  type CanvasFetchResponse,
  type CanvasItem,
  type GridLayouts,
} from "@/lib/types";

export type SharedBoardLoadState<TCanvas> =
  | { status: "loading" }
  | { status: "ready"; canvas: TCanvas }
  | { status: "error" };

export type SharedBoardPage = { id: string; items: CanvasItem[]; layouts: GridLayouts };

export const SHARED_BOARD_LOADING_LABEL = "Loading board...";
export const SHARED_BOARD_NOT_FOUND_LABEL = "Board not found.";

export function storedBoardObjectKey(id: string) {
  return `canvases/${id}.json`;
}

export function storedBoardFetchUrl(id: string) {
  return `/api/share?key=${encodeURIComponent(storedBoardObjectKey(id))}`;
}

export function resolveStoredSharedBoard(value: unknown): CanvasFetchResponse | null {
  const canvas = isLockedCanvasStub(value) ? value : sanitizePublicCanvasManifest(value);
  return canvas ?? null;
}

export async function readStoredSharedBoardResponse(res: Response): Promise<CanvasFetchResponse | null> {
  if (!res.ok) throw new Error("Board not found");
  const body = (await res.json().catch(() => null)) as unknown;
  return resolveStoredSharedBoard(body);
}

export function hydrateSharedBoardPages(canvas: Canvas): SharedBoardPage[] {
  return canvas.pages.map((page, index) => {
    const baseItems = page.items as CanvasItem[];
    const items =
      index === 0 && canvas.generation && !baseItems.some((item) => item.id === BOARD_SUMMARY_ITEM_ID)
        ? [...baseItems, { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" as const }]
        : baseItems;
    // AutoCanvas packs missing ids on render, so an empty `layouts` is fine —
    // the viewer sees the fresh masonry layout, and any persisted positions
    // from the author's drags take precedence.
    const layouts = page.layouts ?? { lg: [], sm: [] };
    return { id: page.id, items, layouts };
  });
}
