import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { SharedCanvas } from "@/components/shared-canvas";
import { importFromUrl, type ImportError } from "@/lib/board-import";
import { editorPagesFromCanvas } from "@/lib/board-lifecycle";
import { parseHandoffFragment } from "@/lib/handoff";
import { saveLocalDraft } from "@/lib/local-draft";
import { readPageIndexFromUrl } from "@/lib/pagination";
import { SHARED_BOARD_LOADING_LABEL } from "@/lib/shared-board";
import type { Canvas } from "@/lib/types";

const HANDOFF_GONE_LABEL = "That handoff code has expired or was already used.";
const HANDOFF_INVALID_LABEL = "That handoff link looks invalid";
const HANDOFF_FETCH_FAILED_LABEL = "Couldn't reach the server — check your connection";

type HandoffError = Extract<ImportError, "invalid-input" | "fetch-failed" | "handoff-gone">;
type HandoffState =
  | { status: "loading" }
  | { status: "ready"; canvas: Canvas }
  | { status: "error"; error: HandoffError };

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
  const [state, setState] = useState<HandoffState>({ status: "loading" });

  useEffect(() => {
    let disposed = false;
    let runId = 0;
    const load = async () => {
      if (typeof window === "undefined") return;
      const id = ++runId;
      setState({ status: "loading" });
      const code = parseHandoffFragment(window.location.hash);
      if (!code) {
        if (!disposed && id === runId) setState({ status: "error", error: "invalid-input" });
        return;
      }
      const result = await importFromUrl(code);
      if (disposed || id !== runId) return;
      if (result.ok) {
        setState({ status: "ready", canvas: result.canvas });
      } else {
        setState({ status: "error", error: handoffError(result.error) });
      }
    };
    void load();
    window.addEventListener("hashchange", load);
    return () => {
      disposed = true;
      window.removeEventListener("hashchange", load);
    };
  }, []);

  const openOnMyBoard = useCallback(async () => {
    if (state.status !== "ready") return;
    try {
      await saveLocalDraft(editorPagesFromCanvas(state.canvas));
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
          cta={(
            <button type="button" className="board-cta-link" onClick={() => void openOnMyBoard()}>
              <span>Open on my board</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        />
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
      {handoffErrorLabel(state.error)}
    </div>
  );
}

function handoffError(error: ImportError): HandoffError {
  return error === "fetch-failed" || error === "handoff-gone" ? error : "invalid-input";
}

function handoffErrorLabel(error: HandoffError) {
  if (error === "invalid-input") return HANDOFF_INVALID_LABEL;
  if (error === "fetch-failed") return HANDOFF_FETCH_FAILED_LABEL;
  return HANDOFF_GONE_LABEL;
}
