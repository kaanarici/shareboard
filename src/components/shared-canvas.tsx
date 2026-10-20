import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { Board } from "@/lib/types";
import { Canvas } from "@/components/canvas";
import { BoardCarousel } from "@/components/board-carousel";
import { PageNav } from "@/components/page-nav";
import { estimateMaxRowsFromViewport } from "@/lib/tile-specs";
import { copyWithToast } from "@/lib/clipboard";
import { pagesFromBoard } from "@/lib/board-lifecycle";
import { useBoardPageSearch } from "@/lib/pagination";
import { X as XIcon } from "@/components/ui/svgs/x";
import { InstagramIcon } from "@/components/ui/svgs/instagramIcon";
import { Linkedin } from "@/components/ui/svgs/linkedin";
import { ArrowRight, Share2 } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";

const SOCIAL_LINKS = [
  { key: "xUrl", label: "X", icon: <XIcon className="w-3 h-3 [&_path]:fill-current" /> },
  { key: "instagramUrl", label: "Instagram", icon: <InstagramIcon className="w-3 h-3" /> },
  { key: "linkedinUrl", label: "LinkedIn", icon: <Linkedin className="w-3 h-3" /> },
] as const;

export function SharedCanvas({
  canvas,
  cta,
}: {
  canvas: Board;
  cta?: ReactNode;
}) {
  const [maxRows, setMaxRows] = useState(estimateMaxRowsFromViewport);

  const pages = useMemo(() => pagesFromBoard(canvas), [canvas]);
  const { activePage, setActivePage } = useBoardPageSearch(pages.length);

  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  onKeyRef.current = (e: KeyboardEvent) => {
    if (!(e.target instanceof HTMLElement)) return;
    const target = e.target;
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const share = async () => {
    const url = window.location.href;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: `${canvas.author} on Shareboard`, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copyWithToast(url, "Link copied", "Couldn't share link");
  };

  const socials = SOCIAL_LINKS.flatMap((link) => {
    const url = canvas.authorProfile?.[link.key];
    return url ? [{ ...link, url }] : [];
  });

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <div className="board-notch" aria-label="Board info">
        <span className="board-notch-meta">
          <span className="board-notch-meta-name">{canvas.author}</span>
        </span>
        {socials.length > 0 && (
          <>
            <span className="board-notch-divider" aria-hidden />
            <span className="board-notch-socials">
              {socials.map(({ key, url, label, icon }) => (
                <Hint key={key} label={label}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="board-notch-social"
                    aria-label={`${label} profile`}
                  >
                    {icon}
                  </a>
                </Hint>
              ))}
            </span>
          </>
        )}
        <span className="board-notch-divider" aria-hidden />
        <button
          type="button"
          className="board-notch-action"
          onClick={share}
          aria-label="Share this board"
        >
          <Share2 className="h-3.5 w-3.5" />
          <span>Share</span>
        </button>
      </div>

      <BoardCarousel
        pages={pages}
        activeIndex={activePage}
        onNavigate={(delta) => setActivePage(activePage + delta)}
        renderPage={(page, _i, isActive) => (
          <Canvas
            items={page.items}
            layouts={page.layouts}
            maxRows={maxRows}
            onMaxRowsChange={isActive ? setMaxRows : undefined}
            readonly
          />
        )}
      />

      <div className="board-toolbar" aria-label="Board navigation">
        <span className="board-toolbar-left" />
        <span className="board-toolbar-center">
          <PageNav
            pageCount={pages.length}
            activeIndex={activePage}
            onChange={setActivePage}
          />
        </span>
        <span className="board-toolbar-right">
          {cta ?? (
            <Link to="/" className="board-cta-link">
              <span>Make your own</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}
