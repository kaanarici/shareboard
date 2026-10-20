import { useRouter, useSearch } from "@tanstack/react-router";
import { isRecord } from "@/lib/json";

export type PageSearch = {
  page?: number;
};

export function clampPageIndex(page: number, pageCount: number) {
  if (!Number.isFinite(page) || page < 0) return 0;
  return Math.max(0, Math.min(Math.floor(page), Math.max(0, pageCount - 1)));
}

export function readPageParam(value: unknown): number | undefined {
  const raw = Number(value);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : undefined;
}

export function validatePageSearch(search: unknown): PageSearch {
  const page = isRecord(search) ? readPageParam(search.page) : undefined;
  return page === undefined ? {} : { page };
}

function pageHref(pathname: string, hash: string, pageIndex: number) {
  const search = pageIndex === 0 ? "" : `?page=${pageIndex + 1}`;
  return `${pathname}${search}${hash}`;
}

export function useBoardPageSearch(pageCount: number) {
  const router = useRouter();
  const search = useSearch({ strict: false });
  const urlPage = ("page" in search ? readPageParam(search.page) : undefined) ?? 1;
  const activePage = clampPageIndex(urlPage - 1, pageCount);

  const setActivePage = (next: number) => {
    const clamped = clampPageIndex(next, pageCount);
    const { pathname, hash } = router.state.location;
    void router.navigate({ href: pageHref(pathname, hash, clamped) });
  };

  return { activePage, setActivePage };
}
