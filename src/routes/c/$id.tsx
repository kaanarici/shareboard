import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { isLockedCanvasStub, type CanvasFetchResponse } from "@/lib/types";
import { sanitizePublicCanvasManifest } from "@/lib/canvas-sanitize";
import { SharedCanvas } from "@/components/shared-canvas";
import { LockedCanvas } from "@/components/locked-canvas";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; canvas: CanvasFetchResponse }
  | { status: "error" };

type SharedSearch = { page?: number };

type SharedHeadData = {
  title: string;
  description?: string;
  previewUrl?: string;
} | null;

const getSharedHead = createServerFn({ method: "GET" })
  .inputValidator((data: unknown): { id: string } => {
    if (!data || typeof data !== "object" || typeof (data as { id: unknown }).id !== "string") {
      throw new Error("Invalid id");
    }
    return { id: (data as { id: string }).id };
  })
  .handler(async ({ data }): Promise<SharedHeadData> => {
    const { getObjectText } = await import("@/lib/r2");
    const raw = await getObjectText(`canvases/${data.id}.json`);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (parsed && typeof parsed === "object" && "encrypted" in parsed) return null;
    const manifest = sanitizePublicCanvasManifest(parsed);
    if (!manifest) return null;
    const title = manifest.generation?.overall_summary?.title?.trim() || `${manifest.author}'s board`;
    const description = manifest.generation?.overall_summary?.explanation?.trim().slice(0, 200);
    return {
      title,
      ...(description ? { description } : {}),
      ...(manifest.previewUrl ? { previewUrl: manifest.previewUrl } : {}),
    };
  });

export const Route = createFileRoute("/c/$id")({
  validateSearch: (search): SharedSearch => {
    const raw = Number(search.page);
    if (!Number.isFinite(raw) || raw < 1) return {};
    return { page: Math.floor(raw) };
  },
  loader: async ({ params }) => {
    try {
      return await getSharedHead({ data: { id: params.id } });
    } catch {
      return null;
    }
  },
  head: ({ loaderData }) => {
    const data = loaderData as SharedHeadData;
    const title = data?.title ?? "Shareboard";
    const meta: Array<Record<string, string>> = [
      { title },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: title },
      { property: "og:type", content: "website" },
    ];
    if (data?.description) {
      meta.push({ name: "description", content: data.description });
      meta.push({ property: "og:description", content: data.description });
    }
    if (data?.previewUrl) {
      meta.push({ property: "og:image", content: data.previewUrl });
      meta.push({ property: "og:image:width", content: "1200" });
      meta.push({ property: "og:image:height", content: "630" });
      meta.push({ name: "twitter:card", content: "summary_large_image" });
      meta.push({ name: "twitter:image", content: data.previewUrl });
    }
    return { meta };
  },
  component: SharedPage,
  notFoundComponent: () => (
    <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
      Board not found.
    </div>
  ),
});

function SharedPage() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      setState({ status: "loading" });
      try {
        const res = await fetch(
          `/api/share?key=${encodeURIComponent(`canvases/${id}.json`)}`,
          { signal: controller.signal }
        );
        if (!res.ok) throw new Error("Board not found");
        const body = (await res.json().catch(() => null)) as unknown;
        const canvas = isLockedCanvasStub(body) ? body : sanitizePublicCanvasManifest(body);
        if (!canvas) throw new Error("Board not found");
        setState({ status: "ready", canvas });
      } catch (error) {
        if ((error as DOMException)?.name === "AbortError") return;
        setState({ status: "error" });
      }
    };

    void load();
    return () => controller.abort();
  }, [id]);

  if (state.status === "loading") {
    return <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Loading board...</div>;
  }
  if (state.status === "error") {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        Board not found.
      </div>
    );
  }
  const { canvas } = state;
  if (isLockedCanvasStub(canvas)) {
    return <LockedCanvas id={canvas.id} initialPageIndex={(search.page ?? 1) - 1} />;
  }
  return <SharedCanvas canvas={canvas} initialPageIndex={(search.page ?? 1) - 1} />;
}
