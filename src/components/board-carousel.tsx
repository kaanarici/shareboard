import { useEffect, useRef, useState, type ReactNode } from "react";

const AXIS_LOCK_PX = 8;
const COMMIT_RATIO = 0.18;
const OVERDRAG_RESIST = 0.35;

export function BoardCarousel<T extends { id: string }>({
  pages,
  activeIndex,
  renderPage,
  onNavigate,
}: {
  pages: T[];
  activeIndex: number;
  renderPage: (page: T, index: number, isActive: boolean) => ReactNode;
  onNavigate?: (delta: -1 | 1) => void;
}) {
  const pageCount = pages.length;
  const safeIndex = pageCount === 0 ? 0 : Math.max(0, Math.min(activeIndex, pageCount - 1));
  const viewportRef = useRef<HTMLDivElement>(null);
  const [dragDx, setDragDx] = useState<number | null>(null);

  const latest = useRef({ safeIndex, pageCount, onNavigate });
  latest.current = { safeIndex, pageCount, onNavigate };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    let state: { x0: number; y0: number; locked: "h" | "v" | null; dx: number } | null = null;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const { onNavigate: nav, pageCount } = latest.current;
      if (!nav || pageCount < 2) return;
      const t = e.touches[0];
      if (!t) return;
      state = { x0: t.clientX, y0: t.clientY, locked: null, dx: 0 };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!state) return;
      const { safeIndex: idx, pageCount } = latest.current;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - state.x0;
      const dy = t.clientY - state.y0;
      if (!state.locked) {
        if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
        state.locked = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
      if (state.locked !== "h") return;
      e.preventDefault();
      let resisted = dx;
      const atStart = idx === 0 && dx > 0;
      const atEnd = idx === pageCount - 1 && dx < 0;
      if (atStart || atEnd) resisted = dx * OVERDRAG_RESIST;
      state.dx = resisted;
      setDragDx(resisted);
    };

    const onTouchEnd = () => {
      const st = state;
      state = null;
      if (!st || st.locked !== "h") {
        setDragDx(null);
        return;
      }
      const { safeIndex: idx, pageCount, onNavigate: nav } = latest.current;
      const vw = el.clientWidth || window.innerWidth;
      const dx = st.dx;
      const threshold = vw * COMMIT_RATIO;
      if (nav) {
        if (dx < -threshold && idx < pageCount - 1) nav(1);
        else if (dx > threshold && idx > 0) nav(-1);
      }
      setDragDx(null);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    el.addEventListener("touchcancel", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, []);

  const basePct = pageCount === 0 ? 0 : (safeIndex * 100) / pageCount;
  const dragging = dragDx !== null;

  return (
    <div ref={viewportRef} className="board-carousel-viewport">
      <div
        className="board-carousel-track"
        style={{
          width: `${Math.max(1, pageCount) * 100}%`,
          transform: dragging
            ? `translate3d(calc(-${basePct}% + ${dragDx}px), 0, 0)`
            : `translate3d(-${basePct}%, 0, 0)`,
          transition: dragging ? "none" : undefined,
        }}
      >
        {pages.map((page, i) => (
          <div
            key={page.id}
            className="board-carousel-slide"
            style={{ width: `${100 / Math.max(1, pageCount)}%` }}
            aria-hidden={i !== safeIndex || undefined}
          >
            {renderPage(page, i, i === safeIndex)}
          </div>
        ))}
      </div>
    </div>
  );
}
