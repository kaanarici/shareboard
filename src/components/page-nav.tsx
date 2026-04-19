import { ChevronLeft, ChevronRight } from "lucide-react";

export function PageNav({
  pageCount,
  activeIndex,
  onChange,
  className,
}: {
  pageCount: number;
  activeIndex: number;
  onChange: (next: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const safeIndex = Math.max(0, Math.min(activeIndex, pageCount - 1));

  return (
    <div
      className={`board-nav-pill${className ? " " + className : ""}`}
      role="group"
      aria-label="Pages"
    >
      <button
        type="button"
        onClick={() => onChange(safeIndex - 1)}
        disabled={safeIndex === 0}
        className="board-nav-pill-btn"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="board-nav-pill-divider" aria-hidden />
      <span className="board-nav-pill-count">
        {safeIndex + 1} / {pageCount}
      </span>
      <div className="board-nav-pill-divider" aria-hidden />
      <button
        type="button"
        onClick={() => onChange(safeIndex + 1)}
        disabled={safeIndex === pageCount - 1}
        className="board-nav-pill-btn"
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
