import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SharedCanvas } from "@/components/shared-canvas";
import { Button } from "@/components/ui/button";
import { importFromUrl } from "@/lib/board-import";
import { editorPagesFromCanvas } from "@/lib/board-lifecycle";
import { parseHandoffFragment } from "@/lib/handoff";
import { saveLocalDraft } from "@/lib/local-draft";
import { readPageIndexFromUrl } from "@/lib/pagination";
import { SHARED_BOARD_LOADING_LABEL } from "@/lib/shared-board";
import type { Canvas } from "@/lib/types";
import { useSharedBoardLoad } from "@/lib/use-shared-board-load";

const HANDOFF_GONE_LABEL = "That handoff code has expired or was already used.";

export const Route = createFileRoute("/h")({
  head: () => ({
    meta: [
      { title: "Shareboard" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: HandoffReceivePage,
});

function HandoffReceivePage() {
  // The code lives only in the URL fragment, so it never reaches the server as a
  // query or path. importFromUrl's handoff branch derives the storage id from it
  // locally, does the one-time GET, and decrypts client-side.
  const loadHandoff = useCallback(async (): Promise<Canvas | null> => {
    if (typeof window === "undefined") return null;
    const code = parseHandoffFragment(window.location.hash);
    if (!code) return null;
    const result = await importFromUrl(code);
    return result.ok ? result.canvas : null;
  }, []);

  const state = useSharedBoardLoad<Canvas>({ load: loadHandoff });

  const openOnMyBoard = useCallback(async () => {
    if (state.status !== "ready") return;
    try {
      await saveLocalDraft(editorPagesFromCanvas(state.canvas), state.canvas.generation ?? null);
    } catch {
      // Local storage unavailable — keep the preview rather than navigating to
      // an empty board, so the handed-off content isn't silently lost.
      return;
    }
    // Full navigation so Home hydrates the freshly saved draft from IndexedDB.
    window.location.assign("/");
  }, [state]);

  if (state.status === "ready") {
    return (
      <>
        <SharedCanvas
          canvas={state.canvas}
          initialPageIndex={readPageIndexFromUrl(state.canvas.pages.length)}
        />
        <div className="fixed left-1/2 top-2 z-50 -translate-x-1/2">
          <Button type="button" onClick={() => void openOnMyBoard()}>
            Open on my board
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </>
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
      {HANDOFF_GONE_LABEL}
    </div>
  );
}
