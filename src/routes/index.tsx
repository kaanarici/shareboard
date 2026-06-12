import { createFileRoute } from "@tanstack/react-router";
import { Home } from "@/components/home";

type HomeSearch = {
  page?: number;
  // PWA share-target intake. `shared=1` means a POST share-target worker may
  // have stashed files in IDB; title/text/url are still ingested from params.
  shared?: "1";
  title?: string;
  text?: string;
  url?: string;
};

const SHARE_PARAM_MAX = 4000;

function shareParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, SHARE_PARAM_MAX);
}

export const Route = createFileRoute("/")({
  validateSearch: (search): HomeSearch => {
    const result: HomeSearch = {};
    const raw = Number(search.page);
    if (Number.isFinite(raw) && raw >= 1) result.page = Math.floor(raw);
    // TanStack's search parser JSON-parses values, so ?shared=1 arrives as the
    // number 1 — accept both shapes.
    if (search.shared === "1" || search.shared === 1) result.shared = "1";
    const title = shareParam(search.title);
    if (title) result.title = title;
    const text = shareParam(search.text);
    if (text) result.text = text;
    const url = shareParam(search.url);
    if (url) result.url = url;
    return result;
  },
  component: Home,
});
