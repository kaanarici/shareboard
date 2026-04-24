import { useEffect, useMemo, useRef, useState } from "react";
import { useMountEffect } from "@/lib/use-mount-effect";
import type { Canvas as CanvasType, CanvasItem, GridLayouts } from "@/lib/types";
import { BOARD_SUMMARY_ITEM_ID } from "@/lib/types";
import { Canvas } from "@/components/canvas";
import { BoardCarousel } from "@/components/board-carousel";
import { PageNav } from "@/components/page-nav";
import { estimateMaxRowsFromViewport } from "@/lib/tile-specs";
import { notify } from "@/lib/toast";
import { X as XIcon } from "@/components/ui/svgs/x";
import { InstagramIcon } from "@/components/ui/svgs/instagramIcon";
import { Linkedin } from "@/components/ui/svgs/linkedin";

type Page = { id: string; items: CanvasItem[]; layouts: GridLayouts };

function readPageIndex(pageCount: number) {
  if (typeof window === "undefined") return 0;
  const raw = Number(new URLSearchParams(window.location.search).get("page"));
  if (!Number.isFinite(raw) || raw < 1) return 0;
  return Math.max(0, Math.min(Math.floor(raw) - 1, pageCount - 1));
}

export function SharedCanvas({ canvas }: { canvas: CanvasType }) {
  const [maxRows, setMaxRows] = useState(estimateMaxRowsFromViewport);

  const pages = useMemo<Page[]>(() => {
    return canvas.pages.map((page, idx) => {
      const baseItems = page.items as CanvasItem[];
      const items =
        idx === 0 && canvas.generation && !baseItems.some((i) => i.id === BOARD_SUMMARY_ITEM_ID)
          ? [...baseItems, { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" as const }]
          : baseItems;
      // AutoCanvas packs missing ids on render, so an empty `layouts` is fine —
      // the viewer sees the fresh masonry layout, and any persisted positions
      // from the author's drags take precedence.
      const layouts = page.layouts ?? { lg: [], sm: [] };
      return { id: page.id, items, layouts };
    });
  }, [canvas.pages, canvas.generation, maxRows]);

  const [activePage, setActivePageIndex] = useState(() => readPageIndex(canvas.pages.length));
  const pageCountRef = useRef(pages.length);
  pageCountRef.current = pages.length;

  const setActivePage = (next: number) => {
    const clamped = Math.max(0, Math.min(next, pages.length - 1));
    setActivePageIndex(clamped);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (clamped === 0) url.searchParams.delete("page");
    else url.searchParams.set("page", String(clamped + 1));
    window.history.pushState(null, "", url);
  };

  useEffect(() => {
    setActivePageIndex((page) => Math.max(0, Math.min(page, pages.length - 1)));
  }, [pages.length]);

  useMountEffect(() => {
    const onPopState = () => setActivePageIndex(readPageIndex(pageCountRef.current));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  });

  // Latest-handler ref: install the keydown listener once on mount, route to
  // the current closure so activePage/pages.length changes don't resubscribe.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) {
      return;
    }
    if (e.key === "ArrowLeft" && activePage > 0) {
      e.preventDefault();
      setActivePage(activePage - 1);
    }
    if (e.key === "ArrowRight" && activePage < pages.length - 1) {
      e.preventDefault();
      setActivePage(activePage + 1);
    }
  };
  useMountEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const p = canvas.authorProfile;

  // navigator.share is mobile-native (iOS/Android system sheet); on desktop
  // Chrome/Edge it exists too but UX is meh — clipboard fallback is fine for
  // anything that throws (user-cancel "AbortError" is also swallowed silently).
  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (!url) return;
    const title = `${canvas.author} — Shareboard`;
    const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
    if (canNativeShare) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if ((err as DOMException)?.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      notify.success("Link copied");
    } catch {
      notify.error("Couldn't share link");
    }
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-black/[0.06]">
        <span className="text-xs font-medium tracking-tight text-muted-foreground shrink-0">
          Shareboard
        </span>
        <div className="flex items-center gap-2 min-w-0 justify-end">
          <span className="text-xs text-muted-foreground truncate">{canvas.author}</span>
          {p && (p.xUrl || p.instagramUrl || p.linkedinUrl) && (
            <div className="flex items-center gap-1.5 shrink-0">
              {p.xUrl && (
                <a
                  href={p.xUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md p-1 text-foreground/50 transition-colors hover:text-foreground hover:bg-black/5"
                  aria-label="X profile"
                >
                  <XIcon className="w-3.5 h-3.5 shrink-0 [&_path]:fill-current" />
                </a>
              )}
              {p.instagramUrl && (
                <a
                  href={p.instagramUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md p-1 text-foreground/50 transition-colors hover:text-foreground hover:bg-black/5"
                  aria-label="Instagram profile"
                >
                  <InstagramIcon className="w-3.5 h-3.5 shrink-0" />
                </a>
              )}
              {p.linkedinUrl && (
                <a
                  href={p.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md p-1 text-foreground/50 transition-colors hover:text-foreground hover:bg-black/5"
                  aria-label="LinkedIn profile"
                >
                  <Linkedin className="w-3.5 h-3.5 shrink-0" />
                </a>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={share}
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-tight bg-black text-white hover:bg-black/85 active:scale-[0.98] transition"
            aria-label="Share this board"
          >
            Share
          </button>
        </div>
      </div>

      <BoardCarousel
        pages={pages}
        activeIndex={activePage}
        onNavigate={(delta) => setActivePage(activePage + delta)}
        renderPage={(page, _i, isActive) => (
          <Canvas
            items={page.items}
            generation={canvas.generation}
            layouts={page.layouts}
            maxRows={maxRows}
            onMaxRowsChange={isActive ? setMaxRows : undefined}
            readonly
          />
        )}
      />

      {pages.length > 1 && (
        <div className="board-toolbar" aria-label="Board navigation">
          <PageNav
            pageCount={pages.length}
            activeIndex={activePage}
            onChange={setActivePage}
          />
        </div>
      )}
    </div>
  );
}
