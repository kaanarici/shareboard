import { imageSource, type ImageItem } from "@/lib/types";

export function ImageCard({
  item,
  onMeasure,
}: {
  item: ImageItem;
  onMeasure?: (ratio: number) => void;
}) {
  const src = imageSource(item);
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
            draggable={false}
            loading="lazy"
            decoding="async"
            onLoad={handleLoad}
          />
        </div>
      ) : (
        <img
          src={src}
          alt={item.caption ?? "Screenshot"}
          className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10"
          draggable={false}
          loading="lazy"
          decoding="async"
          onLoad={handleLoad}
        />
      )}
      {item.caption && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8">
          <p className="line-clamp-2 text-xs text-white/90">
            {item.caption}
          </p>
        </div>
      )}
    </div>
  );
}
