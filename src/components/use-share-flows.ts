import { useCallback, useRef, useState } from "react";
import type { BoardOrigin } from "@/lib/board-origin";
import { useMountEffect } from "@/lib/use-mount-effect";
import { copyText } from "@/lib/clipboard";
import { readErrorMessage } from "@/lib/fetch-helpers";
import {
  clearLastSharedBoard,
  getBoardHistory,
  getLastSharedBoard,
  getName,
  getProfile,
  removeBoardHistoryEntry,
  saveBoardHistory,
  saveLastSharedBoard,
  type BoardHistoryEntry,
} from "@/lib/store";
import { fetchStoredCanvas, unlockSharedBoard } from "@/lib/board-import";
import { createHistoryEntry, prepareLockedShare, preparePublicShare } from "@/lib/share-workflow";
import { useIsMobile } from "@/lib/use-is-mobile";
import { notify } from "@/lib/toast";
import {
  type BoardPage,
  type Canvas as SharedCanvasData,
  type GenerateResponse,
  isShareCreateResponse,
} from "@/lib/types";

async function readShareCreateResponse(res: Response) {
  const body = (await res.json().catch(() => null)) as unknown;
  if (!isShareCreateResponse(body)) throw new Error("Invalid share response");
  return body;
}

export function useShareFlows({
  pages,
  generation,
  boardOrigin,
  onRestoreBoard,
  onOriginChange,
}: {
  pages: BoardPage[];
  generation: GenerateResponse | null;
  boardOrigin: BoardOrigin;
  onRestoreBoard: (canvas: SharedCanvasData, origin: BoardOrigin) => void;
  onOriginChange: (origin: BoardOrigin) => void;
}) {
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied">("idle");
  const [manualShareUrl, setManualShareUrl] = useState("");
  const [lockedShareOpen, setLockedShareOpen] = useState(false);
  const [lockedShareBusy, setLockedShareBusy] = useState(false);
  const [history, setHistory] = useState<BoardHistoryEntry[]>([]);
  const [openingEntryId, setOpeningEntryId] = useState<string | null>(null);
  const shareResetTimer = useRef<number | null>(null);
  const isMobile = useIsMobile();

  useMountEffect(() => {
    setHistory(getBoardHistory());
    return () => {
      if (shareResetTimer.current !== null) window.clearTimeout(shareResetTimer.current);
    };
  });

  const markShareCopied = useCallback(() => {
    setShareState("copied");
    if (shareResetTimer.current !== null) window.clearTimeout(shareResetTimer.current);
    shareResetTimer.current = window.setTimeout(() => {
      setShareState("idle");
      shareResetTimer.current = null;
    }, 1800);
  }, []);

  const finishShare = useCallback(
    async (shareUrl: string) => {
      if (await copyText(shareUrl)) {
        markShareCopied();
        notify.success("Link copied to clipboard");
        return;
      }
      setShareState("idle");
      setManualShareUrl(shareUrl);
      notify.success("Share link ready");
    },
    [markShareCopied],
  );

  const share = useCallback(async () => {
    if (shareState === "sharing") return;
    setShareState("sharing");
    try {
      const draft = await preparePublicShare({
        pages,
        generation,
        author: getName(),
        authorProfile: getProfile(),
        boardOrigin,
        baseUrl: window.location.origin,
        isMobile,
        previewRoot: document.querySelector<HTMLElement>("[data-share-preview-root]"),
      });

      if (draft.kind === "tiny") {
        clearLastSharedBoard();
        saveBoardHistory(createHistoryEntry({
          id: draft.historyEntryId,
          kind: "tiny",
          shareUrl: draft.url,
          metadata: draft.metadata,
          canvas: draft.canvas,
        }));
        onOriginChange({ kind: "draft", replaceHistoryId: draft.historyEntryId });
        setHistory(getBoardHistory());
        await finishShare(draft.url);
        return;
      }

      const res = await fetch("/api/share", { method: "POST", body: draft.form });
      if (!res.ok) {
        setShareState("idle");
        const message = await readErrorMessage(res, "Failed to share");
        if (draft.isReplace && (res.status === 403 || res.status === 404)) {
          notify.error("This share was edited or removed elsewhere. Refresh to continue.");
        } else {
          notify.error(message);
        }
        return;
      }
      const { id, deleteToken } = await readShareCreateResponse(res);
      const shareUrl = `${window.location.origin}/c/${id}`;
      saveLastSharedBoard({ id, deleteToken, shareUrl });
      if (draft.replaceHistoryId) {
        removeBoardHistoryEntry(draft.replaceHistoryId);
      }
      saveBoardHistory(createHistoryEntry({
        id,
        kind: "stored",
        shareUrl,
        metadata: draft.metadata,
        deleteToken,
      }));
      onOriginChange({ kind: "stored", id, deleteToken });
      setHistory(getBoardHistory());
      if (draft.isReplace) {
        notify.success("Updated link copied");
        if (await copyText(shareUrl)) markShareCopied();
        else {
          setShareState("idle");
          setManualShareUrl(shareUrl);
        }
      } else {
        await finishShare(shareUrl);
      }
    } catch (error) {
      setShareState("idle");
      notify.error(error instanceof Error ? error.message : "Failed to share");
    }
  }, [pages, generation, boardOrigin, shareState, isMobile, finishShare, markShareCopied, onOriginChange]);

  const shareLocked = useCallback(
    async (pin: string) => {
      if (lockedShareBusy || shareState === "sharing") return;
      setLockedShareBusy(true);
      setShareState("sharing");
      try {
        const draft = await prepareLockedShare({
          pages,
          generation,
          boardOrigin,
          pin,
          author: getName(),
          authorProfile: getProfile(),
        });

        const res = await fetch("/api/share", { method: "POST", body: draft.form });
        if (!res.ok) {
          if (draft.isReplace && (res.status === 403 || res.status === 404)) {
            throw new Error("This share was edited or removed elsewhere. Refresh to continue.");
          }
          throw new Error(await readErrorMessage(res, "Failed to create locked share"));
        }
        const { id: shareId, deleteToken } = await readShareCreateResponse(res);
        const shareUrl = `${window.location.origin}/c/${shareId}`;
        saveLastSharedBoard({ id: shareId, deleteToken, shareUrl });
        saveBoardHistory(createHistoryEntry({
          id: shareId,
          kind: "locked",
          shareUrl,
          metadata: draft.metadata,
          deleteToken,
        }));
        onOriginChange({ kind: "locked", id: shareId, deleteToken });
        setHistory(getBoardHistory());
        setLockedShareOpen(false);
        if (draft.isReplace) {
          notify.success("Updated link copied");
          if (await copyText(shareUrl)) markShareCopied();
          else {
            setShareState("idle");
            setManualShareUrl(shareUrl);
          }
        } else {
          await finishShare(shareUrl);
        }
      } catch (error) {
        setShareState("idle");
        notify.error(error instanceof Error ? error.message : "Failed to create locked share");
      } finally {
        setLockedShareBusy(false);
      }
    },
    [pages, generation, boardOrigin, lockedShareBusy, shareState, finishShare, markShareCopied, onOriginChange],
  );

  const openHistoryEntry = useCallback(
    async (entry: BoardHistoryEntry) => {
      if (entry.kind === "tiny") {
        if (!entry.canvas || !Array.isArray(entry.canvas.pages)) {
          notify.error("This local history entry cannot be restored");
          return;
        }
        onRestoreBoard(entry.canvas, { kind: "draft", replaceHistoryId: entry.id });
        notify.success("Board restored");
        return;
      }
      if (entry.kind === "stored") {
        if (!entry.deleteToken) {
          notify.error("Re-share this board once to enable in-place editing.");
          return;
        }
        setOpeningEntryId(entry.id);
        try {
          const result = await fetchStoredCanvas(entry.id);
          if (!result.ok) {
            notify.error(
              result.error === "locked"
                ? "This share is locked. Open the link to view it."
                : "Couldn't load that board",
            );
            return;
          }
          onRestoreBoard(result.canvas, {
            kind: "stored",
            id: entry.id,
            deleteToken: entry.deleteToken,
          });
          notify.success("Board ready to edit");
        } finally {
          setOpeningEntryId(null);
        }
        return;
      }
      // Locked entry
      if (!entry.deleteToken) {
        notify.error("Re-share this board once to enable in-place editing.");
        return;
      }
      setOpeningEntryId(entry.id);
      try {
        const pin = window.prompt("Enter the 6-digit pin for this locked share");
        if (!pin || !/^\d{6}$/.test(pin.trim())) {
          if (pin !== null) notify.error("Pin must be 6 digits");
          return;
        }
        const result = await unlockSharedBoard(entry.id, pin.trim());
        if (!result.ok) {
          notify.error(
            result.error === "wrong-pin"
              ? "Wrong pin"
              : "Couldn't unlock that board",
          );
          return;
        }
        onRestoreBoard(result.canvas, {
          kind: "locked",
          id: entry.id,
          deleteToken: entry.deleteToken,
        });
        notify.success("Board ready to edit");
      } finally {
        setOpeningEntryId(null);
      }
    },
    [onRestoreBoard],
  );

  const removeHistoryEntry = useCallback(async (entry: BoardHistoryEntry) => {
    if (entry.deleteToken && (entry.kind === "stored" || entry.kind === "locked")) {
      try {
        const res = await fetch(`/api/share?id=${encodeURIComponent(entry.id)}`, {
          method: "DELETE",
          headers: { "x-delete-token": entry.deleteToken },
        });
        if (!res.ok && res.status !== 404) {
          notify.error(await readErrorMessage(res, "Failed to delete share"));
          // Still drop from history — keeping stale entries is worse UX.
        }
      } catch {
        // Network failure: still drop the local entry.
      }
      const last = getLastSharedBoard();
      if (last?.id === entry.id) clearLastSharedBoard();
    }
    removeBoardHistoryEntry(entry.id);
    setHistory(getBoardHistory());
  }, []);

  return {
    shareState,
    manualShareUrl,
    setManualShareUrl,
    lockedShareOpen,
    setLockedShareOpen,
    lockedShareBusy,
    history,
    openingEntryId,
    share,
    shareLocked,
    openHistoryEntry,
    removeHistoryEntry,
    markShareCopied,
  };
}
