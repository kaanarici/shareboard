import type { LayoutItem } from "react-grid-layout";

/**
 * Intrinsic sizing metadata for a single tile. Given to <AutoCanvas> as a map
 * keyed by tile id; the packer uses it to place new tiles and the runtime uses
 * it to reflow aspect-locked heights when the container resizes.
 *
 * A spec with `aspect` means "lock height to width * (1/aspect)" — aspect is
 * pxWidth / pxHeight, matching react-grid-layout's aspectRatio() constraint.
 */
export interface TileSpec {
  /** Aspect ratio = pxWidth / pxHeight. When provided, height tracks width. */
  aspect?: number;
  /** Natural max pixel width (e.g. 550 for X/Twitter embeds). Packer prefers spans where `span*colPx <= maxWidthPx`. */
  maxWidthPx?: number;
  /** Minimum column span (defaults to 3). */
  minSpan?: number;
  /** Preferred column span when no aspect drives width (used by the packer's initial sizing). */
  preferredSpan?: number;
  /** Minimum rows (defaults to 3). */
  minRows?: number;
  /** Preferred rows when no aspect drives height. Flex content cards use this. */
  preferredRows?: number;
  /** If true, the packer leaves this tile's existing layout untouched. */
  pinned?: boolean;
}

export type TileSpecMap = Record<string, TileSpec | undefined>;

/** Layout, but shaped for AutoCanvas's persisted storage. Just a pair of breakpoints. */
export interface AutoLayouts {
  lg: LayoutItem[];
  sm: LayoutItem[];
}
