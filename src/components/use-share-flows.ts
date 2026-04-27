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
import { createTinyShareUrl } from "@/lib/tiny-share";
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
  onRestoreBoard,
}: {
  pages: BoardPage[];
  generation: GenerateResponse | null;
  onRestoreBoard: (canvas: SharedCanvasData) => void;
}) {
  const [shareState, setShareState] = useState<"idle" | "sharing" | "copied">("idle");
  const [manualShareUrl, setManualShareUrl] = useState("");
  const [lockedShareOpen, setLockedShareOpen] = useState(false);
  const [lockedShareBusy, setLockedShareBusy] = useState(false);
  const [hasLastSharedBoard, setHasLastSharedBoard] = useState(false);
  const [isDeletingShare, setIsDeletingShare] = useState(false);
  const [history, setHistory] = useState<BoardHistoryEntry[]>([]);
  const shareResetTimer = useRef<number | null>(null);

  useMountEffect(() => {
    setHasLastSharedBoard(!!getLastSharedBoard());
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

      const hasImages = pages.some((page) => page.items.some((item) => item.type === "image"));
      if (!hasImages) {
        const tinyCanvas = canvasFromTextOnlyPayload(payload, generation);
        const tinyUrl = await createTinyShareUrl(tinyCanvas, window.location.origin);
        if (tinyUrl) {
          clearLastSharedBoard();
          setHasLastSharedBoard(false);
          saveBoardHistory({
            id: `tiny:${Date.now()}`,
            kind: "tiny",
            title,
            subtitle: getHistorySubtitle("tiny", tinyCanvas.pages.length, itemCount),
            shareUrl: tinyUrl,
            createdAt: tinyCanvas.createdAt,
            itemCount,
            pageCount: tinyCanvas.pages.length,
            canvas: tinyCanvas,
          });
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

      const previewNode = document.querySelector<HTMLElement>("[data-share-preview-root]");
      if (previewNode) {
        const preview = await capturePreview(previewNode);
        if (preview) form.set("preview", preview, "preview.png");
      }

      const res = await fetch("/api/share", { method: "POST", body: form });
      if (!res.ok) {
        setShareState("idle");
        notify.error(await readErrorMessage(res, "Failed to share"));
        return;
      }
      const { id, deleteToken } = await readShareCreateResponse(res);
      const shareUrl = `${window.location.origin}/c/${id}`;
      saveLastSharedBoard({ id, deleteToken, shareUrl });
      setHasLastSharedBoard(true);
      saveBoardHistory({
        id,
        kind: "stored",
        title,
        subtitle: getHistorySubtitle("stored", payload.pages.length, itemCount),
        shareUrl,
        createdAt: new Date().toISOString(),
        itemCount,
        pageCount: payload.pages.length,
      });
      setHistory(getBoardHistory());
      await finishShare(shareUrl);
    } catch (error) {
      setShareState("idle");
      notify.error(error instanceof Error ? error.message : "Failed to share");
    }
  }, [pages, generation, shareState, finishShare]);

  const shareLocked = useCallback(
    async (pin: string) => {
      if (lockedShareBusy || shareState === "sharing") return;
      setLockedShareBusy(true);
      setShareState("sharing");
      try {
        const id = createLockedShareId();
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

        const res = await fetch("/api/share", { method: "POST", body: form });
        if (!res.ok) {
          throw new Error(await readErrorMessage(res, "Failed to create locked share"));
        }
        const { id: shareId, deleteToken } = await readShareCreateResponse(res);
        const shareUrl = `${window.location.origin}/c/${shareId}`;
        saveLastSharedBoard({ id: shareId, deleteToken, shareUrl });
        setHasLastSharedBoard(true);
        saveBoardHistory({
          id: shareId,
          kind: "locked",
          title,
          subtitle: getHistorySubtitle("locked", securePages.length, itemCount),
          shareUrl,
          createdAt,
          itemCount,
          pageCount: securePages.length,
        });
        setHistory(getBoardHistory());
        setLockedShareOpen(false);
        await finishShare(shareUrl);
      } catch (error) {
        setShareState("idle");
        notify.error(error instanceof Error ? error.message : "Failed to create locked share");
      } finally {
        setLockedShareBusy(false);
      }
    },
    [pages, generation, lockedShareBusy, shareState, finishShare],
  );

  const deleteLastShare = useCallback(async () => {
    const lastShare = getLastSharedBoard();
    if (!lastShare) {
      notify.error("No saved share to delete");
      setHasLastSharedBoard(false);
      return;
    }

    setIsDeletingShare(true);
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(lastShare.id)}`, {
        method: "DELETE",
        headers: { "x-delete-token": lastShare.deleteToken },
      });
      if (!res.ok) {
        notify.error(await readErrorMessage(res, "Failed to delete share"));
        return;
      }

      clearLastSharedBoard();
      setHasLastSharedBoard(false);
      notify.success("Last shared board deleted");
    } catch {
      notify.error("Failed to delete share");
    } finally {
      setIsDeletingShare(false);
    }
  }, []);

  const openHistoryEntry = useCallback(
    (entry: BoardHistoryEntry) => {
      if (entry.canvas && Array.isArray(entry.canvas.pages)) {
        onRestoreBoard(entry.canvas);
        notify.success("Board restored");
        return;
      }
      if (entry.kind === "tiny") {
        notify.error("This local history entry cannot be restored");
        return;
      }
      window.open(entry.shareUrl, "_blank", "noopener,noreferrer");
    },
    [onRestoreBoard],
  );

  const removeHistoryEntry = useCallback((id: string) => {
    removeBoardHistoryEntry(id);
    setHistory(getBoardHistory());
  }, []);

  return {
    shareState,
    manualShareUrl,
    setManualShareUrl,
    lockedShareOpen,
    setLockedShareOpen,
    lockedShareBusy,
    hasLastSharedBoard,
    isDeletingShare,
    history,
    share,
    shareLocked,
    deleteLastShare,
    openHistoryEntry,
    removeHistoryEntry,
    markShareCopied,
  };
}
