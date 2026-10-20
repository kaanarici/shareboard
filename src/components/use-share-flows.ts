import { useCallback, useEffect, useRef, useState } from "react";
import type { Board, BoardOrigin, BoardPage, ShareCreateResponse, StoredShareKind } from "@/lib/types";
import { copyText } from "@/lib/clipboard";
import { currentAuthor } from "@/lib/store";
import { deleteBoardEntry, originFromBoardEntry, recordShare, type BoardListEntry } from "@/lib/boards";
import { importBoard, unlockBoard } from "@/lib/share-import";
import { hasImageItems, prepareLockedShare, prepareShare } from "@/lib/share-prepare";
import { deleteRemoteShare, postShare } from "@/lib/share-api";
import { cleanPin, isCompletePin } from "@/lib/crypto";
import { useIsMobile } from "@/lib/use-is-mobile";
import { notify } from "@/lib/toast";

export function useShareFlows(editor: {
  pages: BoardPage[];
  boardOrigin: BoardOrigin;
  currentBoardId: string | null;
  restoreBoard: (board: Board, origin: BoardOrigin, boardId: string | null) => void;
  boardSession: () => number;
  attachToBoardEntry: (session: number, entry: BoardListEntry, origin: BoardOrigin) => void;
  forgetBoard: (id: string) => void | Promise<void>;
  clearShareSheetRef: { current: () => void };
}, canPublish: boolean) {
  const {
    pages,
    boardOrigin,
    currentBoardId,
    restoreBoard,
    boardSession,
    attachToBoardEntry,
    forgetBoard,
    clearShareSheetRef,
  } = editor;
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied">("idle");
  const [manualShareUrl, setManualShareUrl] = useState("");
  const [lockedShareOpen, setLockedShareOpen] = useState(false);
  const [lockedShareBusy, setLockedShareBusy] = useState(false);
  const [unlockEntry, setUnlockEntry] = useState<BoardListEntry | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [openingEntryId, setOpeningEntryId] = useState<string | null>(null);
  const [ownerOnlyOpen, setOwnerOnlyOpen] = useState(false);
  const shareResetTimer = useRef<number | null>(null);
  const shareInFlightRef = useRef(false);
  const isMobile = useIsMobile();

  useEffect(
    () => () => {
      if (shareResetTimer.current !== null) window.clearTimeout(shareResetTimer.current);
    },
    [],
  );

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
      if (await copyText(shareUrl)) markShareCopied();
      else setShareState("idle");
      setManualShareUrl(shareUrl);
    },
    [markShareCopied],
  );

  const finishStoredShare = useCallback(
    async (session: number, kind: StoredShareKind, created: ShareCreateResponse, title: string) => {
      const shareUrl = `${window.location.origin}/c/${created.id}`;
      const entry = await recordShare({ kind, title, shareUrl, currentId: currentBoardId, ...created });
      attachToBoardEntry(session, entry, { kind, ...created });
      await finishShare(shareUrl);
    },
    [attachToBoardEntry, currentBoardId, finishShare],
  );

  const runShare = useCallback(
    async (fallback: string, work: () => Promise<void>) => {
      if (shareInFlightRef.current) return;
      shareInFlightRef.current = true;
      setShareState("sharing");
      try {
        await work();
      } catch (error) {
        setShareState("idle");
        notify.error(error instanceof Error && error.message ? error.message : fallback);
      } finally {
        shareInFlightRef.current = false;
      }
    },
    [],
  );

  const share = useCallback(() => {
    if (!canPublish && hasImageItems(pages)) {
      setOwnerOnlyOpen(true);
      return;
    }
    void runShare("Failed to share", async () => {
      const session = boardSession();
      const draft = await prepareShare({
        pages,
        boardOrigin,
        author: currentAuthor(),
        baseUrl: window.location.origin,
        isMobile,
        previewRoot: document.querySelector<HTMLElement>("[data-share-preview-root]"),
        canStore: canPublish,
      });
      if (draft.kind === "tiny") {
        const entry = await recordShare({ kind: "tiny", title: draft.title, shareUrl: draft.url, currentId: currentBoardId });
        attachToBoardEntry(session, entry, { kind: "draft" });
        await finishShare(draft.url);
        return;
      }
      const created = await postShare(draft.form, draft.isReplace, "Failed to share");
      await finishStoredShare(session, "stored", created, draft.title);
    });
  }, [
    attachToBoardEntry,
    boardOrigin,
    boardSession,
    canPublish,
    currentBoardId,
    finishShare,
    finishStoredShare,
    isMobile,
    pages,
    runShare,
  ]);

  const shareLocked = useCallback(
    async (pin: string) => {
      if (shareInFlightRef.current) return;
      setLockedShareBusy(true);
      await runShare("Failed to create locked share", async () => {
        const session = boardSession();
        const draft = await prepareLockedShare({ pages, boardOrigin, pin, author: currentAuthor() });
        const created = await postShare(draft.form, draft.isReplace, "Failed to create locked share");
        setLockedShareOpen(false);
        await finishStoredShare(session, "locked", created, draft.title);
      });
      setLockedShareBusy(false);
    },
    [boardOrigin, boardSession, finishStoredShare, pages, runShare],
  );

  const openBoardEntry = useCallback(
    async (entry: BoardListEntry) => {
      setOpeningEntryId(entry.id);
      try {
        const result = await importBoard(entry.shareUrl);
        if (result.ok) {
          restoreBoard(result.canvas, originFromBoardEntry(entry), entry.id);
          notify.success("Board ready to edit");
        } else if (result.error === "locked") {
          setUnlockError("");
          setUnlockEntry({ ...entry, kind: "locked" });
        } else {
          notify.error(result.error === "tiny-decode-failed" ? "Couldn't read that shared board" : "Couldn't load that board");
        }
      } finally {
        setOpeningEntryId(null);
      }
    },
    [restoreBoard],
  );

  const closeUnlock = useCallback(() => {
    if (unlockBusy) return;
    setUnlockEntry(null);
    setUnlockError("");
    setOpeningEntryId(null);
  }, [unlockBusy]);

  const submitUnlockPin = useCallback(
    async (pin: string) => {
      const entry = unlockEntry;
      const nextPin = cleanPin(pin);
      if (!entry || entry.kind !== "locked" || !isCompletePin(nextPin) || unlockBusy) return;
      setUnlockBusy(true);
      setUnlockError("");
      setOpeningEntryId(entry.id);
      try {
        const result = await unlockBoard(entry.id, nextPin);
        if (!result.ok) {
          setUnlockError(result.error === "wrong-pin" ? "Incorrect PIN." : "Couldn't unlock that board");
          return;
        }
        restoreBoard(result.canvas, { kind: "locked", id: entry.id }, entry.id);
        notify.success("Board ready to edit");
        setUnlockEntry(null);
        setUnlockError("");
      } finally {
        setUnlockBusy(false);
        setOpeningEntryId(null);
      }
    },
    [restoreBoard, unlockBusy, unlockEntry],
  );

  const removeBoard = useCallback(
    async (entry: BoardListEntry) => {
      if (!(await deleteRemoteShare(entry, notify.error))) return;
      await deleteBoardEntry(entry.id).catch(() => undefined);
      setManualShareUrl((current) => (current === entry.shareUrl ? "" : current));
      await forgetBoard(entry.id);
    },
    [forgetBoard],
  );

  const clearShareSheet = useCallback(() => setManualShareUrl(""), []);
  useEffect(() => {
    clearShareSheetRef.current = clearShareSheet;
  }, [clearShareSheet, clearShareSheetRef]);

  return {
    shareState,
    manualShareUrl,
    setManualShareUrl,
    lockedShareOpen,
    setLockedShareOpen,
    lockedShareBusy,
    unlockEntry,
    unlockBusy,
    unlockError,
    closeUnlock,
    submitUnlockPin,
    openingEntryId,
    share,
    shareLocked,
    ownerOnlyOpen,
    setOwnerOnlyOpen,
    openBoardEntry,
    removeBoard,
    markShareCopied,
  };
}
