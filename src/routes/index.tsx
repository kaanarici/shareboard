import { createFileRoute } from "@tanstack/react-router";
import { Home } from "@/components/home";

type HomeSearch = {
  page?: number;
  // PWA share-target intake (manifest `share_target`, GET). Ingested once on the
  // canvas, then cleared from the URL so refresh doesn't re-add the item.
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
