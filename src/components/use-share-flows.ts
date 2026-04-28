import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "@/lib/use-mount-effect";
import { copyText } from "@/lib/clipboard";
import {
  createLockedShareId,
  createLockedSharePackage,
  type LockedImageUpload,
} from "@/lib/encrypted-share";
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
import { capturePreview } from "@/lib/share-preview";
import { fetchStoredCanvas, unlockSharedBoard } from "@/lib/board-import";
import { createTinyShareUrl } from "@/lib/tiny-share";
import { useIsMobile } from "@/lib/use-is-mobile";
import { notify } from "@/lib/toast";
import {
  isDraftImageItem,
  isShareCreateResponse,
  type BoardPage,
  type Canvas as SharedCanvasData,
  type GenerateResponse,
  type NoteItem,
  type ShareRequestItem,
  type ShareRequestPayload,
  type UrlItem,
} from "@/lib/types";

/**
 * Editor hint describing where the current pages came from. Drives the share
 * button: replace-in-place when origin points at an existing remote, otherwise
 * mint a new id. Tiny replaces don't have a remote — they collapse the prior
 * history entry so the user sees one row.
 */
export type BoardOrigin =
  | { kind: "draft"; replaceHistoryId?: string }
  | { kind: "stored"; id: string; deleteToken: string }
  | { kind: "locked"; id: string; deleteToken: string };

type TitleableItem =
  | { type: "note"; text: string }
  | { type: "url"; url: string }
  | { type: "image"; caption?: string }
  | { type: string };
type TitleablePage = { items: readonly TitleableItem[] };

function getBoardTitle(pages: readonly TitleablePage[]) {
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type === "note" && "text" in item && item.text.trim()) {
        return item.text.trim().replace(/\s+/g, " ").slice(0, 42);
      }
      if (item.type === "url" && "url" in item) {
        try {
          return new URL(item.url).hostname.replace(/^www\./, "");
        } catch {
          return item.url.slice(0, 42);
        }
      }
      if (item.type === "image") {
        const caption = "caption" in item ? item.caption?.trim() : "";
        return caption || "Image board";
      }
    }
  }
  return "Untitled board";
}

function getHistorySubtitle(kind: BoardHistoryEntry["kind"], pageCount: number, itemCount: number) {
  const itemLabel = itemCount === 1 ? "item" : "items";
  const pageLabel = pageCount === 1 ? "page" : "pages";
  const prefix = kind === "tiny" ? "Stored in link" : kind === "locked" ? "Locked share" : "Public share";
  return `${prefix} · ${itemCount} ${itemLabel} · ${pageCount} ${pageLabel}`;
}

function shareItemFromEditor(item: BoardPage["items"][number]): ShareRequestItem | null {
  if (item.type === "board_summary") return null;
  if (item.type === "image") {
    return {
      id: item.id,
      type: "image",
      mimeType: item.mimeType,
      size: item.size,
      caption: item.caption,
    };
  }
  return item;
}

function collectSharePayload(
  pages: BoardPage[],
  generation: GenerateResponse | null,
): ShareRequestPayload {
  return {
    author: getName(),
    authorProfile: getProfile(),
    generation,
    pages: pages.map((page) => ({
      id: page.id,
      layouts: page.layouts,
      items: page.items.map(shareItemFromEditor).filter((item): item is ShareRequestItem => !!item),
    })),
  };
}

function canvasFromTextOnlyPayload(payload: ShareRequestPayload, generation: GenerateResponse | null): SharedCanvasData {
  return {
    id: "tiny",
    author: typeof payload.author === "string" && payload.author ? payload.author : "Anonymous",
    authorProfile: getProfile(),
    pages: payload.pages.map((page) => ({
      id: page.id,
      layouts: page.layouts,
      items: page.items.filter(
        (item): item is UrlItem | NoteItem => item.type === "url" || item.type === "note",
      ),
    })),
    ...(generation ? { generation } : {}),
    createdAt: new Date().toISOString(),
  };
}

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
      const form = new FormData();
      const payload = collectSharePayload(pages, generation);

      form.set("payload", JSON.stringify(payload));
      const itemCount = payload.pages.reduce((n, page) => n + page.items.length, 0);
      const title = getBoardTitle(payload.pages);

      const isReplaceStored = boardOrigin.kind === "stored";
      const hasImages = pages.some((page) => page.items.some((item) => item.type === "image"));

      // Tiny path: only when there are no images AND this isn't a stored-replace
      // (replace must hit the same /c/{id} URL, which requires the stored path).
      if (!hasImages && !isReplaceStored) {
        const tinyCanvas = canvasFromTextOnlyPayload(payload, generation);
        const tinyUrl = await createTinyShareUrl(tinyCanvas, window.location.origin);
        if (tinyUrl) {
          clearLastSharedBoard();
          const entryId =
            boardOrigin.kind === "draft" && boardOrigin.replaceHistoryId
              ? boardOrigin.replaceHistoryId
              : `tiny:${Date.now()}`;
          saveBoardHistory({
            id: entryId,
            kind: "tiny",
            title,
            subtitle: getHistorySubtitle("tiny", tinyCanvas.pages.length, itemCount),
            shareUrl: tinyUrl,
            createdAt: tinyCanvas.createdAt,
            itemCount,
            pageCount: tinyCanvas.pages.length,
            canvas: tinyCanvas,
          });
          onOriginChange({ kind: "draft", replaceHistoryId: entryId });
          setHistory(getBoardHistory());
          await finishShare(tinyUrl);
          return;
        }
      }

      for (const page of pages) {
        for (const item of page.items) {
          if (item.type === "board_summary") continue;
          if (isDraftImageItem(item)) {
            form.set(`image:${item.id}`, item.file, item.file.name || `${item.id}.bin`);
          }
        }
      }

      // Skip the OG-card capture on mobile: the live DOM is a single-column
      // stack, not the desktop 1200×630 shape, so a snapshot would look wrong.
      // The server preserves the prior previewUrl on replace when no new
      // preview is uploaded, so a desktop-captured preview survives a mobile
      // edit.
      if (!isMobile) {
        const previewNode = document.querySelector<HTMLElement>("[data-share-preview-root]");
        if (previewNode) {
          const preview = await capturePreview(previewNode);
          if (preview) form.set("preview", preview, "preview.png");
        }
      }

      if (isReplaceStored) {
        form.set("replaceId", boardOrigin.id);
        form.set("replaceToken", boardOrigin.deleteToken);
      }

      const res = await fetch("/api/share", { method: "POST", body: form });
      if (!res.ok) {
        setShareState("idle");
        const message = await readErrorMessage(res, "Failed to share");
        if (isReplaceStored && (res.status === 403 || res.status === 404)) {
          notify.error("This share was edited or removed elsewhere. Refresh to continue.");
        } else {
          notify.error(message);
        }
        return;
      }
      const { id, deleteToken } = await readShareCreateResponse(res);
      const shareUrl = `${window.location.origin}/c/${id}`;
      saveLastSharedBoard({ id, deleteToken, shareUrl });
      // Editing a tiny entry that now contains images promotes it to a stored
      // share — drop the old tiny row so the user sees one entry, not two.
      if (boardOrigin.kind === "draft" && boardOrigin.replaceHistoryId) {
        removeBoardHistoryEntry(boardOrigin.replaceHistoryId);
      }
      saveBoardHistory({
        id,
        kind: "stored",
        title,
        subtitle: getHistorySubtitle("stored", payload.pages.length, itemCount),
        shareUrl,
        createdAt: new Date().toISOString(),
        itemCount,
        pageCount: payload.pages.length,
        deleteToken,
      });
      onOriginChange({ kind: "stored", id, deleteToken });
      setHistory(getBoardHistory());
      if (isReplaceStored) {
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
      const isReplaceLocked = boardOrigin.kind === "locked";
      try {
        const id = isReplaceLocked ? boardOrigin.id : createLockedShareId();
        const createdAt = new Date().toISOString();
        const imageUploads: LockedImageUpload[] = [];
        const securePages: SharedCanvasData["pages"] = [];

        for (const page of pages) {
          const items: SharedCanvasData["pages"][number]["items"] = [];
          for (const item of page.items) {
            if (item.type === "board_summary") continue;
            if (item.type !== "image") {
              items.push(item);
              continue;
            }

            const key = `images/${id}/${page.id}/${item.id}`;
            const source = isDraftImageItem(item)
              ? item.file
              : await fetch(item.url).then((res) => {
                  if (!res.ok) throw new Error("Could not prepare image for locked share");
                  return res.blob();
                });
            imageUploads.push({ id: item.id, pageId: page.id, key, file: source });
            items.push({
              id: item.id,
              type: "image",
              url: "",
              objectKey: key,
              mimeType: item.mimeType,
              size: item.size,
              caption: item.caption,
            });
          }
          securePages.push({ id: page.id, layouts: page.layouts, items });
        }

        const itemCount = securePages.reduce((n, page) => n + page.items.length, 0);
        const title = getBoardTitle(securePages);
        const canvas: SharedCanvasData = {
          id,
          author: getName() || "Anonymous",
          authorProfile: getProfile(),
          pages: securePages,
          ...(generation ? { generation } : {}),
          createdAt,
        };
        const locked = await createLockedSharePackage(pin, canvas, imageUploads);
        const form = new FormData();
        form.set("pin", pin);
        form.set("encryptedPayload", JSON.stringify(locked.envelope));
        for (const file of locked.files) {
          form.set(
            `encrypted-image:${file.id}`,
            new File([file.data], `${file.id}.bin`, { type: "application/octet-stream" }),
          );
        }
        if (isReplaceLocked) {
          form.set("replaceId", boardOrigin.id);
          form.set("replaceToken", boardOrigin.deleteToken);
        }

        const res = await fetch("/api/share", { method: "POST", body: form });
        if (!res.ok) {
          if (isReplaceLocked && (res.status === 403 || res.status === 404)) {
            throw new Error("This share was edited or removed elsewhere. Refresh to continue.");
          }
          throw new Error(await readErrorMessage(res, "Failed to create locked share"));
        }
        const { id: shareId, deleteToken } = await readShareCreateResponse(res);
        const shareUrl = `${window.location.origin}/c/${shareId}`;
        saveLastSharedBoard({ id: shareId, deleteToken, shareUrl });
        saveBoardHistory({
          id: shareId,
          kind: "locked",
          title,
          subtitle: getHistorySubtitle("locked", securePages.length, itemCount),
          shareUrl,
          createdAt,
          itemCount,
          pageCount: securePages.length,
          deleteToken,
        });
        onOriginChange({ kind: "locked", id: shareId, deleteToken });
        setHistory(getBoardHistory());
        setLockedShareOpen(false);
        if (isReplaceLocked) {
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
