/** Clamp a 0-based page index into [0, pageCount-1]. NaN/negative collapses to 0. */
export function clampPageIndex(page: number, pageCount: number) {
  if (!Number.isFinite(page) || page < 0) return 0;
  return Math.max(0, Math.min(Math.floor(page), Math.max(0, pageCount - 1)));
}

/** Read the 0-based page index from the URL `?page=` query (1-based). */
export function readPageIndexFromUrl(pageCount: number) {
  if (typeof window === "undefined") return 0;
  const raw = Number(new URLSearchParams(window.location.search).get("page"));
  return clampPageIndex(raw - 1, pageCount);
}
