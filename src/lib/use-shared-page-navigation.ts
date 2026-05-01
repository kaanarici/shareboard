import { useEffect, useRef, useState } from "react";
import { clampPageIndex, readPageIndexFromUrl } from "@/lib/pagination";
import { useMountEffect } from "@/lib/use-mount-effect";

export function useSharedPageNavigation({
  initialPageIndex,
  pageCount,
}: {
  initialPageIndex: number;
  pageCount: number;
}) {
  const [activePage, setActivePageIndex] = useState(() =>
    clampPageIndex(initialPageIndex, pageCount),
  );

  const pageCountRef = useRef(pageCount);
  pageCountRef.current = pageCount;

  const setActivePage = (next: number) => {
    const clamped = Math.max(0, Math.min(next, pageCount - 1));
    setActivePageIndex(clamped);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (clamped === 0) url.searchParams.delete("page");
    else url.searchParams.set("page", String(clamped + 1));
    window.history.pushState(null, "", url);
  };

  useEffect(() => {
    setActivePageIndex((page) => clampPageIndex(page, pageCount));
  }, [pageCount]);

  useMountEffect(() => {
    const onPopState = () => setActivePageIndex(readPageIndexFromUrl(pageCountRef.current));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  });

  return { activePage, setActivePage };
}
