import type { BoardOrigin } from "@/lib/board-origin";
import { createLockedShareId, createLockedSharePackage, type LockedImageUpload } from "@/lib/encrypted-share";
import { capturePreview } from "@/lib/share-preview";
import {
  canvasFromTextOnlyPayload,
  collectSharePayload,
  countPayloadItems,
  getBoardTitle,
  getHistorySubtitle,
  hasImageItems,
  resolveTinyHistoryEntryId,
  type ShareHistoryKind,
} from "@/lib/share-prep";
import { createTinyShareUrl } from "@/lib/tiny-share";
import { isDraftImageItem, type AuthorProfile, type BoardPage, type Canvas, type GenerateResponse } from "@/lib/types";
import type { BoardHistoryEntry } from "@/lib/store";

type ShareMetadata = {
  title: string;
  itemCount: number;
  pageCount: number;
  createdAt: string;
};

export type PublicShareDraft =
  | {
      kind: "tiny";
      url: string;
      canvas: Canvas;
      historyEntryId: string;
      metadata: ShareMetadata;
    }
  | {
      kind: "stored";
      form: FormData;
      isReplace: boolean;
      metadata: ShareMetadata;
      replaceHistoryId?: string;
    };

export async function preparePublicShare({
  pages,
  generation,
  boardOrigin,
  author,
  authorProfile,
  baseUrl,
  isMobile,
  previewRoot,
  now = new Date(),
}: {
  pages: BoardPage[];
  generation: GenerateResponse | null;
  boardOrigin: BoardOrigin;
  author: string;
  authorProfile: AuthorProfile;
  baseUrl: string;
  isMobile: boolean;
  previewRoot?: HTMLElement | null;
  now?: Date;
}): Promise<PublicShareDraft> {
  const payload = collectSharePayload({ pages, generation, author, authorProfile });
  const itemCount = countPayloadItems(payload);
  const metadata: ShareMetadata = {
    title: getBoardTitle(payload.pages),
    itemCount,
    pageCount: payload.pages.length,
    createdAt: now.toISOString(),
  };

  const isReplaceStored = boardOrigin.kind === "stored";
  if (!hasImageItems(pages) && !isReplaceStored) {
    const canvas = canvasFromTextOnlyPayload({
      payload,
      generation,
      authorProfile,
      createdAt: metadata.createdAt,
    });
    const url = await createTinyShareUrl(canvas, baseUrl);
    if (url) {
      return {
        kind: "tiny",
        url,
        canvas,
        historyEntryId: resolveTinyHistoryEntryId(boardOrigin, now.getTime()),
        metadata: { ...metadata, pageCount: canvas.pages.length },
      };
    }
  }

  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  appendDraftImages(form, pages);
  if (!isMobile && previewRoot) {
    const preview = await capturePreview(previewRoot);
    if (preview) form.set("preview", preview, "preview.png");
  }
  if (isReplaceStored) {
    form.set("replaceId", boardOrigin.id);
    form.set("replaceToken", boardOrigin.deleteToken);
  }

  return {
    kind: "stored",
    form,
    isReplace: isReplaceStored,
    metadata,
    ...(boardOrigin.kind === "draft" && boardOrigin.replaceHistoryId
      ? { replaceHistoryId: boardOrigin.replaceHistoryId }
      : {}),
  };
}

export async function prepareLockedShare({
  pages,
  generation,
  boardOrigin,
  pin,
  author,
  authorProfile,
  now = new Date(),
}: {
  pages: BoardPage[];
  generation: GenerateResponse | null;
  boardOrigin: BoardOrigin;
  pin: string;
  author: string;
  authorProfile: AuthorProfile;
  now?: Date;
}) {
  const isReplace = boardOrigin.kind === "locked";
  const id = isReplace ? boardOrigin.id : createLockedShareId();
  const createdAt = now.toISOString();
  const imageUploads: LockedImageUpload[] = [];
  const securePages: Canvas["pages"] = [];

  for (const page of pages) {
    const items: Canvas["pages"][number]["items"] = [];
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
  const canvas: Canvas = {
    id,
    author: author || "Anonymous",
    authorProfile,
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
  if (isReplace) {
    form.set("replaceId", boardOrigin.id);
    form.set("replaceToken", boardOrigin.deleteToken);
  }

  return {
    form,
    isReplace,
    metadata: { title, itemCount, pageCount: securePages.length, createdAt },
  };
}

export function createHistoryEntry({
  id,
  kind,
  shareUrl,
  metadata,
  deleteToken,
  canvas,
}: {
  id: string;
  kind: ShareHistoryKind;
  shareUrl: string;
  metadata: ShareMetadata;
  deleteToken?: string;
  canvas?: Canvas;
}): BoardHistoryEntry {
  return {
    id,
    kind,
    title: metadata.title,
    subtitle: getHistorySubtitle(kind, metadata.pageCount, metadata.itemCount),
    shareUrl,
    createdAt: metadata.createdAt,
    itemCount: metadata.itemCount,
    pageCount: metadata.pageCount,
    ...(deleteToken ? { deleteToken } : {}),
    ...(canvas ? { canvas } : {}),
  };
}

function appendDraftImages(form: FormData, pages: BoardPage[]) {
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type === "board_summary") continue;
      if (isDraftImageItem(item)) {
        form.set(`image:${item.id}`, item.file, item.file.name || `${item.id}.bin`);
      }
    }
  }
}
