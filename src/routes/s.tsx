import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SharedCanvas } from "@/components/shared-canvas";
import { decodeTinyShare, TINY_SHARE_PARAM } from "@/lib/tiny-share";
import { useMountEffect } from "@/lib/use-mount-effect";
import type { Canvas } from "@/lib/types";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; canvas: Canvas }
  | { status: "error" };

function readTinyPayload() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.hash.slice(1)).get(TINY_SHARE_PARAM);
}

function readInitialPageIndex() {
  if (typeof window === "undefined") return 0;
  const raw = Number(new URLSearchParams(window.location.search).get("page"));
  return Number.isFinite(raw) && raw > 1 ? Math.floor(raw) - 1 : 0;
}

export const Route = createFileRoute("/s")({
  head: () => ({
    meta: [
      { title: "Shareboard" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: TinySharedPage,
});

function TinySharedPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useMountEffect(() => {
    let cancelled = false;

    const load = async () => {
      const payload = readTinyPayload();
      if (!payload) {
        setState({ status: "error" });
        return;
      }
      try {
        const canvas = await decodeTinyShare(payload);
        if (!cancelled) setState(canvas ? { status: "ready", canvas } : { status: "error" });
      } catch {
        if (!cancelled) setState({ status: "error" });
      }
    };

    void load();
    window.addEventListener("hashchange", load);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", load);
    };
  });

  if (state.status === "ready") {
    return <SharedCanvas canvas={state.canvas} initialPageIndex={readInitialPageIndex()} />;
  }
  if (state.status === "loading") {
    return <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">Loading board...</div>;
  }
  return (
    <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
      Board not found.
    </div>
  );
}
