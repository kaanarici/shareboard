import type { LayoutItem } from "react-grid-layout";

export interface TileSpec {
  aspect?: number;
  maxWidthPx?: number;
  minSpan?: number;
  preferredSpan?: number;
  minRows?: number;
  preferredRows?: number;
}

export type TileSpecMap = Record<string, TileSpec | undefined>;

export interface AutoLayouts {
  lg: LayoutItem[];
  sm: LayoutItem[];
}
