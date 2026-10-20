import { ChevronLeft, ChevronRight } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";

export function PageNav({
  pageCount,
  activeIndex,
  onChange,
}: {
  pageCount: number;
  activeIndex: number;
  onChange: (next: number) => void;
}) {
  if (pageCount <= 1) return null;
  const safeIndex = Math.max(0, Math.min(activeIndex, pageCount - 1));

  return (
    <div
      className="board-nav-pill"
      role="group"
      aria-label="Pages"
    >
      <Hint label="Previous page">
        <button
          type="button"
          onClick={() => onChange(safeIndex - 1)}
          disabled={safeIndex === 0}
          className="board-nav-pill-btn"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </Hint>
      <div className="board-nav-pill-divider" aria-hidden />
      <span className="board-nav-pill-count">
        {safeIndex + 1} / {pageCount}
      </span>
      <div className="board-nav-pill-divider" aria-hidden />
      <Hint label="Next page">
        <button
          type="button"
          onClick={() => onChange(safeIndex + 1)}
          disabled={safeIndex === pageCount - 1}
          className="board-nav-pill-btn"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </Hint>
    </div>
  );
}
