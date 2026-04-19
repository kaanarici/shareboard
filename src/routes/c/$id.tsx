import { createFileRoute, notFound } from "@tanstack/react-router";
import { getPublicUrl } from "@/lib/r2";
import type { Canvas as CanvasType } from "@/lib/types";
import { SharedCanvas } from "@/components/shared-canvas";

async function loadCanvas(id: string): Promise<CanvasType | null> {
  try {
    const url = getPublicUrl(`canvases/${id}.json`);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as CanvasType;
  } catch {
    return null;
  }
}

type SharedSearch = { page?: number };

export const Route = createFileRoute("/c/$id")({
  validateSearch: (search): SharedSearch => {
    const raw = Number(search.page);
    if (!Number.isFinite(raw) || raw < 1) return {};
    return { page: Math.floor(raw) };
  },
  loader: async ({ params }) => {
    const canvas = await loadCanvas(params.id);
    if (!canvas) throw notFound();
    return { canvas };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { canvas } = loaderData;
    const title = canvas.generation?.overall_summary.title ?? "Shareboard";
    const description =
      canvas.generation?.overall_summary.explanation?.slice(0, 160) ??
      `Shared by ${canvas.author}`;
    return {
      meta: [
        { title: `${title} — Shareboard` },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: "Shareboard" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
      ],
    };
  },
  component: SharedPage,
  notFoundComponent: () => (
    <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
      Board not found.
    </div>
  ),
});

function SharedPage() {
  const { canvas } = Route.useLoaderData();
  return <SharedCanvas canvas={canvas} />;
}
