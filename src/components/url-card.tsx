
import { lazy, Suspense, useState } from "react";
import type { CanvasItem } from "@/lib/types";
import { PlatformIcon } from "./platform-icon";
import { YouTubeEmbed } from "./youtube-embed";

type UrlItem = Extract<CanvasItem, { type: "url" }>;

const TweetEmbed = lazy(() => import("./tweet-embed").then((module) => ({ default: module.TweetEmbed })));

export function UrlCard({
  item,
  readonly,
  onMeasureTweet,
}: {
  item: UrlItem;
  readonly?: boolean;
  onMeasureTweet?: (ratio: number) => void;
}) {
  if (item.platform === "twitter") {
    return (
      <Suspense fallback={<TweetEmbedFallback />}>
        <TweetEmbed
          url={item.url}
          interactionOverlay={!readonly}
          onMeasure={onMeasureTweet}
        />
      </Suspense>
    );
  }

  if (item.platform === "youtube") {
    return <YouTubeEmbed url={item.url} />;
  }

  return <OGCard item={item} readonly={readonly} />;
}

function TweetEmbedFallback() {
  return (
    <div
      className="flex h-full min-h-0 w-full min-w-0 items-center justify-center overflow-hidden rounded-lg bg-white"
      data-theme="light"
    />
  );
}

function OGCard({ item, readonly }: { item: UrlItem; readonly?: boolean }) {
  const og = item.ogData;
  const [imageFailed, setImageFailed] = useState(false);
  const hostname = (() => {
    try { return new URL(item.url).hostname.replace("www.", ""); }
    catch { return item.url; }
  })();

  const showImage = Boolean(og?.image) && !imageFailed;
  const title = og?.title || hostname;
  const description = og?.description;

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={readonly ? undefined : (e) => e.preventDefault()}
      className="flex h-full flex-col bg-card"
    >
      {showImage ? (
        <div className="relative min-h-0 flex-1 bg-muted">
          <img
            src={og?.image}
            alt={og?.title ?? ""}
            className="h-full w-full object-cover outline outline-1 -outline-offset-1 outline-black/10"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center bg-muted/70 p-4">
          <PlatformIcon platform={item.platform} className="h-8 w-8 text-muted-foreground/45" />
        </div>
      )}
      <div className="flex flex-col gap-1.5 p-4">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={item.platform} className="h-4 w-4 shrink-0" />
          <span className="truncate text-[11px] text-muted-foreground/70">{hostname}</span>
        </div>
        <p className="line-clamp-2 text-sm font-semibold leading-snug">{title}</p>
        {description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
    </a>
  );
}
