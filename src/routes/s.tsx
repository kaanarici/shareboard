import { createFileRoute } from "@tanstack/react-router";
import { SharedCanvas } from "@/components/shared-canvas";
import { SharedBoardStatus } from "@/components/shared-board-status";
import { decodeTinyShare, TINY_SHARE_PARAM } from "@/lib/tiny-share";
import { validatePageSearch } from "@/lib/pagination";
import type { Board } from "@/lib/types";
import {
  SHARED_BOARD_LOADING_LABEL,
  SHARED_BOARD_NOT_FOUND_LABEL,
  subscribeToHashChange,
  useSharedBoardLoad,
} from "@/lib/shared-board";

async function loadTinyBoard(): Promise<Board | null> {
  if (typeof window === "undefined") return null;
  const payload = new URLSearchParams(window.location.hash.slice(1)).get(TINY_SHARE_PARAM);
  return payload ? decodeTinyShare(payload) : null;
}

export const Route = createFileRoute("/s")({
  validateSearch: validatePageSearch,
  head: () => ({
    meta: [
      { title: "Shareboard" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: TinySharedPage,
});

function TinySharedPage() {
  const state = useSharedBoardLoad<Board>({
    showLoadingOnReload: false,
    load: loadTinyBoard,
    subscribe: subscribeToHashChange,
  });

  if (state.status === "ready") {
    return <SharedCanvas canvas={state.canvas} />;
  }
  if (state.status === "loading") {
    return <SharedBoardStatus label={SHARED_BOARD_LOADING_LABEL} />;
  }
  return <SharedBoardStatus label={SHARED_BOARD_NOT_FOUND_LABEL} />;
}
