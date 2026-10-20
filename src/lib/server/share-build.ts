import { createHash, randomBytes } from "node:crypto";
import { parseJson, readString } from "@/lib/json";
import { sanitizeShareRequest } from "@/lib/canvas-sanitize";
import { cleanPin, LOCKED_SHARE_PIN_LENGTH } from "@/lib/crypto";
import { verifiedRasterMime } from "@/lib/image-mime";
import { LIMITS } from "@/lib/limits";
import { envelopeProblem } from "@/lib/locked-envelope";
import { badRequest } from "@/lib/server/http";
import { putPublicObject } from "@/lib/server/storage";
import {
  isSharedImageItem,
  type Board,
  type BoardPage,
  type EncryptedBoardEnvelope,
  type EncryptedShareImage,
  type ShareRequest,
  type SharedImageItem,
} from "@/lib/types";

const MB = 1024 * 1024;

export function createShareId() {
  return randomBytes(18).toString("base64url");
}

function randomObjectName() {
  return randomBytes(18).toString("base64url");
}

export function readPin(value: unknown): string {
  const text = readString(value);
  const pin = text ? cleanPin(text) : "";
  return pin.length === LOCKED_SHARE_PIN_LENGTH ? pin : "";
}

export function parseSharePayload(raw: string | undefined): ShareRequest {
  if (!raw) badRequest("Missing payload");
  if (raw.length > LIMITS.maxPayloadChars) badRequest("Board payload is too large");
  const parsed = parseJson(raw);
  if (parsed === null) badRequest("Invalid payload JSON");
  const payload = sanitizeShareRequest(parsed);
  if (!payload) badRequest("Board must include at least one page");
  if (payload.pages.length > LIMITS.maxPages) {
    badRequest(`Board is too large (max ${LIMITS.maxPages} pages)`);
  }
  return payload;
}

export function parseEncryptedPayload(raw: string | undefined): EncryptedBoardEnvelope {
  if (!raw) badRequest("Missing encrypted payload");
  if (raw.length > LIMITS.maxPayloadChars) badRequest("Encrypted board payload is too large");
  const parsed = parseJson(raw);
  if (parsed === null) badRequest("Invalid encrypted payload JSON");
  const result = envelopeProblem(parsed, false);
  if (typeof result === "string") badRequest(result);
  return result;
}

function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function reusableImages(prior: Board, form: FormData): Map<string, SharedImageItem> {
  const byId = new Map<string, SharedImageItem>();
  const byKey = new Map<string, SharedImageItem>();
  for (const page of prior.pages) {
    for (const item of page.items) {
      if (!isSharedImageItem(item)) continue;
      if (!byId.has(item.id)) byId.set(item.id, item);
      byKey.set(item.objectKey, item);
    }
  }
  for (const name of new Set(form.keys())) {
    if (!name.startsWith("reuse:")) continue;
    const id = name.slice("reuse:".length);
    const reused = byKey.get(String(form.get(name)));
    if (reused && !byId.has(id)) byId.set(id, { ...reused, id });
  }
  return byId;
}

export function filesWithPrefix(form: FormData, prefix: string): Map<string, File> {
  const files = new Map<string, File>();
  for (const name of new Set(form.keys())) {
    const value = form.get(name);
    if (name.startsWith(prefix) && value instanceof File) files.set(name.slice(prefix.length), value);
  }
  return files;
}

type UploadedImage = { key: string; url: string; mimeType: string; size: number };

export async function buildSharedPages(
  boardId: string,
  payload: ShareRequest,
  files: ReadonlyMap<string, File>,
  reusable: ReadonlyMap<string, SharedImageItem>,
  uploadedKeys: string[],
): Promise<BoardPage[]> {
  let imageCount = 0;
  let imageBytes = 0;
  let jsonBytes = 0;
  const uploadsByHash = new Map<string, UploadedImage>();
  const pages: BoardPage[] = [];

  const addImageBytes = (bytes: number) => {
    imageBytes += bytes;
    if (imageBytes > LIMITS.maxBoardImageBytes) {
      badRequest(`Images exceed ${LIMITS.maxBoardImageBytes / MB} MB total`);
    }
  };

  for (const page of payload.pages) {
    if (page.items.length > LIMITS.maxItemsPerPage) {
      badRequest(`A page can hold at most ${LIMITS.maxItemsPerPage} items`);
    }
    const items: BoardPage["items"] = [];
    for (const item of page.items) {
      if (item.type === "url" || item.type === "note") {
        items.push(item);
        continue;
      }
      if (item.type === "json") {
        jsonBytes += item.size;
        if (jsonBytes > LIMITS.maxBoardJsonBytes) {
          badRequest(`JSON files exceed ${LIMITS.maxBoardJsonBytes / MB} MB total`);
        }
        items.push(item);
        continue;
      }

      imageCount += 1;
      if (imageCount > LIMITS.maxImages) badRequest(`Too many images (max ${LIMITS.maxImages})`);
      const file = files.get(item.id);
      const reused = reusable.get(item.id);
      if (!file && reused) {
        addImageBytes(reused.size ?? 0);
        const shared: SharedImageItem = { ...reused, id: item.id };
        const caption = item.caption ?? reused.caption;
        if (caption) shared.caption = caption;
        else delete shared.caption;
        items.push(shared);
        continue;
      }
      if (!file) badRequest(`Missing image upload for item ${item.id}`);
      if (file.size > LIMITS.maxImageBytes) {
        badRequest(`Image ${item.id} exceeds ${LIMITS.maxImageBytes / MB} MB`);
      }
      addImageBytes(file.size);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = verifiedRasterMime(bytes, file.type || item.mimeType || "");
      if (!mimeType) badRequest("Only verified PNG, JPEG, GIF, WebP, or AVIF uploads are allowed");
      const hash = sha256Hex(bytes);
      let upload = uploadsByHash.get(hash);
      if (!upload) {
        const key = `images/${boardId}/${randomObjectName()}`;
        uploadedKeys.push(key);
        upload = { key, url: await putPublicObject(key, bytes, mimeType), mimeType, size: file.size };
        uploadsByHash.set(hash, upload);
      }
      const shared: SharedImageItem = {
        id: item.id,
        type: "image",
        url: upload.url,
        objectKey: upload.key,
        mimeType: upload.mimeType,
        size: upload.size,
      };
      if (item.caption) shared.caption = item.caption;
      items.push(shared);
    }
    pages.push({ id: page.id, items, layouts: page.layouts });
  }

  if (!pages.some((page) => page.items.length > 0)) badRequest("Board must include at least one item");
  return pages;
}

export async function uploadPreview(
  boardId: string,
  raw: FormDataEntryValue | null,
  uploadedKeys: string[],
): Promise<string | undefined> {
  if (!(raw instanceof File) || raw.type !== "image/png") return undefined;
  if (raw.size === 0 || raw.size > LIMITS.maxPreviewBytes) return undefined;
  const bytes = new Uint8Array(await raw.arrayBuffer());
  if (verifiedRasterMime(bytes, raw.type) !== "image/png") return undefined;
  const key = `previews/${boardId}/${randomObjectName()}.png`;
  uploadedKeys.push(key);
  return putPublicObject(key, bytes, "image/png");
}

export async function uploadLockedImages(
  envelope: EncryptedBoardEnvelope,
  files: ReadonlyMap<string, File>,
  uploadedKeys: string[],
): Promise<EncryptedShareImage[]> {
  const images: EncryptedShareImage[] = [];
  for (const image of envelope.images) {
    const file = files.get(image.id);
    if (!file) badRequest(`Missing encrypted image upload for item ${image.id}`);
    if (file.size !== image.size) badRequest("Encrypted image size mismatch");
    if (file.size > LIMITS.maxImageBytes + 1024) {
      badRequest(`Image ${image.id} exceeds ${LIMITS.maxImageBytes / MB} MB`);
    }
    const key = `locked-images/${randomBytes(24).toString("base64url")}`;
    uploadedKeys.push(key);
    const url = await putPublicObject(key, await file.arrayBuffer(), "application/octet-stream");
    images.push({ ...image, key, url });
  }
  return images;
}
