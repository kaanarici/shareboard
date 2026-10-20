import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "@/components/editor";
import { getSiteOrigin, siteMeta } from "@/lib/site-meta";
import { isRecord } from "@/lib/json";
import { shareParam, type EditorSearch } from "@/lib/intake";
import { readPageParam } from "@/lib/pagination";

export function validateEditorSearch(search: unknown): EditorSearch {
  const result: EditorSearch = {};
  if (!isRecord(search)) return result;
  const page = readPageParam(search.page);
  if (page !== undefined) result.page = page;
  const shared = shareParam(readSearchParam(search.shared));
  if (shared === "1" || shared === "lost") result.shared = shared;
  const intake = shareParam(readSearchParam(search.intake));
  if (intake && /^[A-Za-z0-9_-]+$/.test(intake)) result.intake = intake;
  const title = shareParam(readSearchParam(search.title));
  if (title) result.title = title;
  const text = shareParam(readSearchParam(search.text));
  if (text) result.text = text;
  const url = shareParam(readSearchParam(search.url));
  if (url) result.url = url;
  return result;
}

function readSearchParam(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export const Route = createFileRoute("/")({
  validateSearch: validateEditorSearch,
  loader: () => getSiteOrigin().catch(() => undefined),
  head: ({ loaderData }) => ({ meta: [{ title: "Shareboard" }, ...siteMeta(loaderData)] }),
  component: Editor,
});
