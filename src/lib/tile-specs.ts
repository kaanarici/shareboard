import type { TileSpec, TileSpecMap } from "@/components/ui/auto-canvas";
import type { CanvasItem } from "./types";
import { extractTweetId } from "./youtube";

/** Grid constants shared between layout generation and the canvas renderer. */
export const LG_COLS = 24;
export const SM_COLS = 1;
export const ROW_HEIGHT = 20;
export const MARGIN = 12;
export const LG_BREAKPOINT = 768;

/** Rough max tweet-card width; matches X/Twitter's embed cap so tiles don't over-stretch. */
export const TWEET_MAX_WIDTH_PX = 550;

/** YouTube renders 16:9 via iframe — force that ratio so height tracks width. */
export const YOUTUBE_ASPECT = 16 / 9;

/** Rough max YouTube-card width. Without this, preferredSpan=12 would
 * give 2 per row regardless of container; with it, chooseSpan rounds to 3+
 * per row on wider screens. */
export const YOUTUBE_MAX_WIDTH_PX = 640;

/**
 * Derive a TileSpec from a CanvasItem. Aspect-locked types (tweet, image,
 * youtube) get exact ratios where known; flex types (note, board_summary, OG
 * cards) use preferredSpan/preferredRows hints for the packer.
 *
 * `aspectCache` maps tweet/image keys to measured pxW/pxH ratios. When a cache
 * hit is available for a tweet, its tile places correctly on first paint
 * instead of jumping after the embed renders.
 */
export function tileSpecFor(
  item: CanvasItem,
  aspectCache?: ReadonlyMap<string, number>,
): TileSpec {
  if (item.type === "board_summary") {
    return { preferredSpan: LG_COLS, preferredRows: 10, minSpan: 6, minRows: 6 };
  }

  if (item.type === "url" && item.platform === "twitter") {
    const tweetId = extractTweetId(item.url);
    const cachedAspect = tweetId ? aspectCache?.get(`tweet:${tweetId}`) : undefined;
    return {
      aspect: cachedAspect,
      maxWidthPx: TWEET_MAX_WIDTH_PX,
      preferredSpan: 8,
      preferredRows: cachedAspect ? undefined : 16,
      minSpan: 4,
      minRows: 6,
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
    // Prefer the aspect measured at paste time — it's set *before* the item
    // enters the layout, so the initial pack (and the spill-to-next-page
    // check in addItemWithSpill) already sees the correct h. The cache is the
    // fallback for shared boards (where we don't measure upfront).
    const key = "url" in item ? `image:${item.url}` : `image:${item.id}`;
    const aspect = ("aspect" in item ? item.aspect : undefined) ?? aspectCache?.get(key);
    return {
      aspect,
      preferredSpan: 8,
      preferredRows: aspect ? undefined : 14,
      minSpan: 3,
      minRows: 4,
    };
  }

  if (item.type === "note") {
    const len = item.text.length;
    const preferredSpan = len < 50 ? 6 : len < 150 ? 8 : 10;
    const preferredRows = len < 50 ? 6 : len < 150 ? 8 : len < 400 ? 10 : 12;
    return { preferredSpan, preferredRows, minSpan: 3, minRows: 4 };
  }

  return { preferredSpan: 8, preferredRows: 12, minSpan: 3, minRows: 3 };
}

/** Build a spec map for an item list, ready to pass to <AutoCanvas tileSpecs=... />. */
export function buildTileSpecs(
  items: CanvasItem[],
  aspectCache?: ReadonlyMap<string, number>,
): TileSpecMap {
  const out: TileSpecMap = {};
  for (const item of items) out[item.id] = tileSpecFor(item, aspectCache);
  return out;
}

/** Build the ordered id+spec list the packer wants. */
export function buildSpecList(
  items: CanvasItem[],
  aspectCache?: ReadonlyMap<string, number>,
): Array<{ id: string } & TileSpec> {
  return items.map((item) => ({ id: item.id, ...tileSpecFor(item, aspectCache) }));
}

/** Matches canvas container math so seeded layouts use the same row budget as the grid. */
export function estimateMaxRowsFromViewport(): number {
  if (typeof window === "undefined") return 24;
  const isLg = window.innerWidth >= LG_BREAKPOINT;
  // Canvas padding: p-3 pb-20 md:p-5 md:pb-24 (side = 12/20, bottom = 80/96).
  // Bottom is larger to reserve the fixed toolbar zone.
  const padTop = isLg ? 20 : 12;
  const padBottom = isLg ? 96 : 80;
  const innerH = window.innerHeight - padTop - padBottom;
  return Math.max(4, Math.floor((innerH + MARGIN) / (ROW_HEIGHT + MARGIN)));
}

/** Container width used for seeding layouts before the canvas measures itself. */
export function estimateContainerWidth(): number {
  if (typeof window === "undefined") return 1200;
  const padding = window.innerWidth >= LG_BREAKPOINT ? 20 : 12;
  return Math.max(320, window.innerWidth - padding * 2);
}
