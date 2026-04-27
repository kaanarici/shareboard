import type { CanvasItem, ItemSummary } from "@/lib/types";

type ImageItem = Extract<CanvasItem, { type: "image" }>;

export function ImageCard({
  item,
  summary,
  onMeasure,
}: {
  item: ImageItem;
  summary?: ItemSummary;
  /** Reports natural pxW/pxH so the canvas can size the tile to match. */
  onMeasure?: (ratio: number) => void;
}) {
  // Image source shape:
  // - shared: `https://pub-.../images/<canvas>/<item>`
  // - draft: `blob:http://localhost:3000/<uuid>`
  const src = ("url" in item ? item.url : item.previewUrl) ?? "";
  const isSvg = item.mimeType === "image/svg+xml";

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (!onMeasure) return;
    const img = e.currentTarget;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return;
    onMeasure(w / h);
  };

  return (
    <div className={`relative h-full w-full ${isSvg ? "" : "bg-card"}`}>
      {isSvg ? (
        <div className="h-full w-full flex items-center justify-center p-3">
          <img
            src={src}
            alt={item.caption ?? "SVG"}
            className="max-h-full max-w-full object-contain"
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
          />
        </div>
      ) : (
        <img
          src={src}
          alt={item.caption ?? "Screenshot"}
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
        />
      )}
      {(summary?.summary || item.caption) && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
          <p className="line-clamp-2 text-xs text-white/90">
            {summary?.summary || item.caption}
          </p>
        </div>
      )}
    </div>
  );
}
