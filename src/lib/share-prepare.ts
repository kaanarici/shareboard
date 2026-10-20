import { notePlainText } from "@/lib/note-html";
import { errorFromResponse } from "@/lib/json";
import { createLockedShareId, createLockedSharePackage, type LockedImageSource } from "@/lib/encrypted-share";
import { createHandoffPackage } from "@/lib/handoff";
import { sniffRasterImageMime } from "@/lib/image-mime";
import { createTinyShareUrl } from "@/lib/tiny-share";
import { isShareImageKey } from "@/lib/storage-keys";
import {
  isDraftImageItem,
  type AuthorProfile,
  type Board,
  type BoardItem,
  type BoardOrigin,
  type BoardPage,
  type ImageItem,
  type ShareRequest,
  type ShareRequestItem,
} from "@/lib/types";

export type ShareAuthor = { author: string; authorProfile: AuthorProfile };

export type StoredShareDraft = { form: FormData; isReplace: boolean; title: string };

export type PublicShareDraft = { kind: "tiny"; url: string; title: string } | ({ kind: "stored" } & StoredShareDraft);

export type HandoffCreateResult =
  | { ok: true; code: string }
  | { ok: false; error: "images" | "create-failed"; message?: string };

const RASTER_ONLY_MESSAGE = "Only verified PNG, JPEG, GIF, WebP, or AVIF uploads are allowed";

type TitleItem = Pick<BoardItem, "type"> & { html?: string; url?: string; name?: string; caption?: string };

export function getBoardTitle(pages: readonly { items: readonly TitleItem[] }[]) {
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type === "note") {
        const title = notePlainText(item.html ?? "").split("\n")[0];
        if (title) return title.slice(0, 42);
      }
      if (item.type === "url" && item.url) {
        try {
          return new URL(item.url).hostname.replace(/^www\./, "");
        } catch {
          return item.url.slice(0, 42);
        }
      }
      if (item.type === "image") return item.caption?.trim() || "Image board";
      if (item.type === "json") return item.name?.trim() || "JSON board";
    }
  }
  return "Untitled board";
}

function requestItem(item: BoardItem): ShareRequestItem {
  if (item.type !== "image") return item;
  const request: ShareRequestItem = { id: item.id, type: "image" };
  if (item.mimeType) request.mimeType = item.mimeType;
  if (item.size !== undefined) request.size = item.size;
  if (item.caption) request.caption = item.caption;
  return request;
}

export function shareRequest(pages: readonly BoardPage[], { author, authorProfile }: ShareAuthor): ShareRequest {
  return {
    author,
    authorProfile,
    pages: pages.map((page) => ({ id: page.id, layouts: page.layouts, items: page.items.map(requestItem) })),
  };
}

export function hasImageItems(pages: readonly BoardPage[]) {
  return pages.some((page) => page.items.some((item) => item.type === "image"));
}

function textOnlyBoard(pages: readonly BoardPage[], { author, authorProfile }: ShareAuthor): Board {
  return {
    id: "tiny",
    author: author || "Anonymous",
    authorProfile,
    pages: pages.map((page) => ({
      id: page.id,
      layouts: page.layouts,
      items: page.items.filter((item) => item.type !== "image"),
    })),
    createdAt: new Date().toISOString(),
  };
}

async function imageBytes(item: ImageItem, failure: string): Promise<Blob> {
  if (isDraftImageItem(item)) return item.file;
  const res = await fetch(item.url);
  if (!res.ok) throw new Error(failure);
  return res.blob();
}

function setReplace(form: FormData, origin: BoardOrigin) {
  if (origin.kind === "draft") return;
  form.set("replaceId", origin.id);
}

export async function prepareShare({
  pages,
  boardOrigin,
  author,
  baseUrl,
  isMobile,
  previewRoot,
  canStore,
}: {
  pages: BoardPage[];
  boardOrigin: BoardOrigin;
  author: ShareAuthor;
  baseUrl: string;
  isMobile: boolean;
  previewRoot?: HTMLElement | null;
  canStore: boolean;
}): Promise<PublicShareDraft> {
  const title = getBoardTitle(pages);
  if (!hasImageItems(pages) && (boardOrigin.kind !== "stored" || !canStore)) {
    const url = await createTinyShareUrl(textOnlyBoard(pages, author), baseUrl);
    if (url) return { kind: "tiny", url, title };
  }
  if (!canStore) throw new Error("This board is too big for a link. Remove a few items and try again.");

  const replacing = boardOrigin.kind === "stored" ? boardOrigin : null;
  const form = new FormData();
  form.set("payload", JSON.stringify(shareRequest(pages, author)));
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type !== "image") continue;
      if (!isDraftImageItem(item) && replacing && isShareImageKey(item.objectKey, replacing.id)) {
        form.set(`reuse:${item.id}`, item.objectKey);
        continue;
      }
      const blob = await imageBytes(item, "Could not read image");
      const name = isDraftImageItem(item) && item.file.name ? item.file.name : `${item.id}.bin`;
      form.set(`image:${item.id}`, new File([blob], name, { type: item.mimeType || blob.type }));
    }
  }
  if (!isMobile && previewRoot) {
    const { capturePreview } = await import("@/lib/share-preview");
    const preview = await capturePreview(previewRoot);
    if (preview) form.set("preview", preview, "preview.png");
  }
  if (replacing) setReplace(form, replacing);
  return { kind: "stored", form, isReplace: !!replacing, title };
}

export async function prepareLockedShare({
  pages,
  boardOrigin,
  pin,
  author,
}: {
  pages: BoardPage[];
  boardOrigin: BoardOrigin;
  pin: string;
  author: ShareAuthor;
}): Promise<StoredShareDraft> {
  const replacing = boardOrigin.kind === "locked" ? boardOrigin : null;
  const images: LockedImageSource[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (item.type !== "image") continue;
      const bytes = new Uint8Array(await (await imageBytes(item, "Could not prepare image for locked share")).arrayBuffer());
      if (!sniffRasterImageMime(bytes)) throw new Error(RASTER_ONLY_MESSAGE);
      images.push({ id: item.id, pageId: page.id, bytes });
    }
  }
  const request = shareRequest(pages, author);
  const locked = await createLockedSharePackage(
    pin,
    {
      id: replacing?.id ?? createLockedShareId(),
      author: author.author || "Anonymous",
      authorProfile: author.authorProfile,
      pages: request.pages,
      createdAt: new Date().toISOString(),
    },
    images,
  );
  const form = new FormData();
  form.set("pin", pin);
  form.set("encryptedPayload", JSON.stringify(locked.envelope));
  for (const file of locked.files) {
    form.set(`encrypted-image:${file.id}`, new File([file.data], `${file.id}.bin`, { type: "application/octet-stream" }));
  }
  if (replacing) setReplace(form, replacing);
  return { form, isReplace: !!replacing, title: getBoardTitle(pages) };
}

export async function prepareHandoff(pages: BoardPage[], author: ShareAuthor): Promise<HandoffCreateResult> {
  if (hasImageItems(pages)) return { ok: false, error: "images" };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const pkg = await createHandoffPackage(textOnlyBoard(pages, author));
      const res = await fetch("/api/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storageId: pkg.storageId, ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt }),
      });
      if (res.status === 201) return { ok: true, code: pkg.code };
      if (res.status !== 409) {
        return { ok: false, error: "create-failed", message: await errorFromResponse(res, "Couldn't create the handoff") };
      }
    }
    return { ok: false, error: "create-failed" };
  } catch {
    return { ok: false, error: "create-failed" };
  }
}
