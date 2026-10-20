import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SharedCanvas } from "@/components/shared-canvas";
import { SharedBoardStatus } from "@/components/shared-board-status";
import { importBoard } from "@/lib/share-import";
import { pagesFromBoard } from "@/lib/board-lifecycle";
import { parseHandoffFragment } from "@/lib/handoff";
import { saveLocalDraft } from "@/lib/local-draft";
import { validatePageSearch } from "@/lib/pagination";
import {
  SHARED_BOARD_LOADING_LABEL,
  SHARED_BOARD_NOT_FOUND_LABEL,
  subscribeToHashChange,
  useSharedBoardLoad,
} from "@/lib/shared-board";
import type { Board } from "@/lib/types";

export const Route = createFileRoute("/h")({
  validateSearch: validatePageSearch,
  head: () => ({
    meta: [
      { title: "Shareboard" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: HandoffReceivePage,
});

async function loadHandoffBoard(): Promise<Board | null> {
  if (typeof window === "undefined") return null;
  const code = parseHandoffFragment(window.location.hash);
  if (!code) return null;
  const result = await importBoard(code);
  return result.ok ? result.canvas : null;
}

function HandoffReceivePage() {
  const state = useSharedBoardLoad<Board>({
    load: loadHandoffBoard,
    subscribe: subscribeToHashChange,
  });

  const openOnMyBoard = useCallback(async () => {
    if (state.status !== "ready") return;
    try {
      await saveLocalDraft({ pages: pagesFromBoard(state.canvas), boardOrigin: { kind: "draft" }, boardId: null });
    } catch {
      return;
    }
    window.location.assign("/");
  }, [state]);

  if (state.status === "ready") {
    return (
      <SharedCanvas
        canvas={state.canvas}
        cta={(
          <button type="button" className="board-cta-link" onClick={() => void openOnMyBoard()}>
            <span>Open on my board</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      />
    );
  }
  if (state.status === "loading") {
    return <SharedBoardStatus label={SHARED_BOARD_LOADING_LABEL} />;
  }
  return <SharedBoardStatus label={SHARED_BOARD_NOT_FOUND_LABEL} />;
}
