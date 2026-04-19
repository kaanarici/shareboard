
import { useCallback, useRef } from "react";
import { Tweet } from "react-tweet";
import { extractTweetId } from "@/lib/youtube";

export function TweetEmbed({
  url,
  interactionOverlay,
  onMeasure,
}: {
  url: string;
  /** Captures pointer events for grid selection; matches tweet frame (550px max, rounded-lg). */
  interactionOverlay?: boolean;
  /** Reports the tweet's natural pxW/pxH ratio once the embed has rendered. */
  onMeasure?: (ratio: number) => void;
}) {
  const id = extractTweetId(url);
  const lastReportedRef = useRef<number | null>(null);
  // Latest onMeasure so the callback-ref observers don't need to reinstall
  // when the parent passes a new function identity.
  const onMeasureRef = useRef(onMeasure);
  onMeasureRef.current = onMeasure;

  // Callback ref: install ResizeObserver + MutationObserver when the embed
  // container mounts, disconnect on unmount. Id changes reflow through the
  // MutationObserver, so we don't need to rewire.
  const contentRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const measure = () => {
      if (!onMeasureRef.current) return;
      const article = el.querySelector("article");
      const target = article ?? el;
      const w = (target as HTMLElement).offsetWidth;
      const h = (target as HTMLElement).offsetHeight;
      // Gate on a real tweet render — skeleton height is ~0 or < 80px.
      if (w < 100 || h < 100) return;
      const ratio = w / h;
      const prev = lastReportedRef.current;
      if (prev && Math.abs(prev - ratio) / ratio < 0.02) return;
      lastReportedRef.current = ratio;
      onMeasureRef.current(ratio);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  if (!id) return <FallbackCard url={url} />;

  return (
    <div
      className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-lg bg-white"
      data-theme="light"
    >
      <div className="relative w-full min-w-0 max-w-[550px] h-full min-h-0 overflow-y-auto overflow-x-hidden rounded-lg">
        <div ref={contentRef} className="tweet-embed-container h-full w-full min-w-0">
          <Tweet id={id} />
        </div>
        {interactionOverlay && (
          <div
            className="absolute inset-0 z-10 rounded-lg pointer-events-auto"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

function FallbackCard({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-full items-center justify-center bg-white p-4 text-sm text-muted-foreground underline"
    >
      View on X
    </a>
  );
}
