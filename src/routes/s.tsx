import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SharedCanvas } from "@/components/shared-canvas";
import { decodeTinyShare, TINY_SHARE_PARAM } from "@/lib/tiny-share";
import { readPageIndexFromUrl } from "@/lib/pagination";
import type { Canvas } from "@/lib/types";
import {
  SHARED_BOARD_LOADING_LABEL,
  SHARED_BOARD_NOT_FOUND_LABEL,
} from "@/lib/shared-board";
import { useSharedBoardLoad } from "@/lib/use-shared-board-load";

function readTinyPayload() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.hash.slice(1)).get(TINY_SHARE_PARAM);
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
  const loadTinyBoard = useCallback(async (): Promise<Canvas | null> => {
    const payload = readTinyPayload();
    if (!payload) return null;
    return decodeTinyShare(payload);
  }, []);

  const subscribeToHashChange = useCallback((reload: () => void) => {
    window.addEventListener("hashchange", reload);
    return () => window.removeEventListener("hashchange", reload);
  }, []);

  const state = useSharedBoardLoad<Canvas>({
    showLoadingOnReload: false,
    load: loadTinyBoard,
    subscribe: subscribeToHashChange,
  });

  if (state.status === "ready") {
    return (
      <SharedCanvas
        canvas={state.canvas}
        initialPageIndex={readPageIndexFromUrl(state.canvas.pages.length)}
      />
    );
  }
  if (state.status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
        {SHARED_BOARD_LOADING_LABEL}
      </div>
    );
  }
  return (
    <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
      {SHARED_BOARD_NOT_FOUND_LABEL}
    </div>
  );
}
