import type { TileSpec, TileSpecMap } from "@/lib/auto-canvas/types";
import { notePlainText } from "@/lib/note-html";
import { imageAspectKey, type BoardItem } from "@/lib/types";

export const LG_COLS = 24;
export const SM_COLS = 1;
export const ROW_HEIGHT = 20;
export const MARGIN = 12;
export const LG_BREAKPOINT = 768;

const TWEET_MAX_WIDTH_PX = 550;

const YOUTUBE_ASPECT = 16 / 9;

const YOUTUBE_MAX_WIDTH_PX = 640;

function tileSpecFor(
  item: BoardItem,
  aspectCache?: ReadonlyMap<string, number>,
): TileSpec {
  if (item.type === "url" && item.platform === "twitter") {
    return {
      maxWidthPx: TWEET_MAX_WIDTH_PX,
      preferredSpan: 8,
      preferredRows: 16,
      minSpan: 4,
      minRows: 5,
    };
  }

  if (item.type === "url" && item.platform === "youtube") {
    return {
      aspect: YOUTUBE_ASPECT,
      maxWidthPx: YOUTUBE_MAX_WIDTH_PX,
      preferredSpan: 12,
      minSpan: 6,
      minRows: 4,
    };
  }

  if (item.type === "url") {
    return { preferredSpan: 8, preferredRows: 14, minSpan: 4, minRows: 6 };
  }

  if (item.type === "image") {
    const aspect = ("aspect" in item ? item.aspect : undefined) ?? aspectCache?.get(imageAspectKey(item));
    return {
      aspect,
      preferredSpan: 8,
      preferredRows: aspect ? undefined : 14,
      minSpan: 3,
      minRows: 4,
    };
  }

  if (item.type === "json") {
    return { preferredSpan: 8, preferredRows: 10, minSpan: 4, minRows: 5 };
  }

  if (item.type === "note") {
    const len = notePlainText(item.html).length;
    const preferredSpan = len < 50 ? 6 : len < 150 ? 8 : 10;
    const preferredRows = len < 50 ? 6 : len < 150 ? 8 : len < 400 ? 10 : 12;
    return { preferredSpan, preferredRows, minSpan: 3, minRows: 4 };
  }

  return { preferredSpan: 8, preferredRows: 12, minSpan: 3, minRows: 3 };
}

export function buildTileSpecs(
  items: BoardItem[],
  aspectCache?: ReadonlyMap<string, number>,
): TileSpecMap {
  const out: TileSpecMap = {};
  for (const item of items) out[item.id] = tileSpecFor(item, aspectCache);
  return out;
}

export function buildSpecList(
  items: BoardItem[],
  aspectCache?: ReadonlyMap<string, number>,
): Array<{ id: string } & TileSpec> {
  return items.map((item) => ({ id: item.id, ...tileSpecFor(item, aspectCache) }));
}

export function estimateMaxRowsFromViewport(): number {
  if (typeof window === "undefined") return 24;
  const isLg = window.innerWidth >= LG_BREAKPOINT;
  const padTop = isLg ? 44 : 12;
  const padBottom = isLg ? 96 : 80;
  const innerH = window.innerHeight - padTop - padBottom;
  return Math.max(4, Math.floor((innerH + MARGIN) / (ROW_HEIGHT + MARGIN)));
}

export function estimateContainerWidth(): number {
  if (typeof window === "undefined") return 1200;
  const padding = window.innerWidth >= LG_BREAKPOINT ? 20 : 12;
  return Math.max(320, window.innerWidth - padding * 2);
}
