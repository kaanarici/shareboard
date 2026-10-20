import { lockedPlaintextAsJson, sanitizeLockedPlaintext } from "@/lib/canvas-sanitize";
import {
  LOCKED_SHARE_ITERATIONS,
  base64UrlToBytes,
  bytesToBase64Url,
  cleanPin,
  decryptAesGcm,
  deriveAesGcmKey,
  encryptAesGcm,
} from "@/lib/crypto";
import { sniffRasterImageMime } from "@/lib/image-mime";
import { parseJson } from "@/lib/json";
import { layoutsForItems, revokeDraftImagePreviews } from "@/lib/board-lifecycle";
import type { Board, BoardItem, DraftImageItem, EncryptedBoardEnvelope, LockedPlaintext, ShareRequestItem } from "@/lib/types";

export type LockedImageSource = { id: string; pageId: string; bytes: Uint8Array<ArrayBuffer> };

export type LockedSharePackage = {
  envelope: EncryptedBoardEnvelope;
  files: Array<{ id: string; data: Uint8Array<ArrayBuffer> }>;
};

export function createLockedShareId() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}

export async function createLockedSharePackage(
  pin: string,
  plaintext: LockedPlaintext,
  images: readonly LockedImageSource[],
): Promise<LockedSharePackage> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveAesGcmKey(cleanPin(pin), salt, LOCKED_SHARE_ITERATIONS, ["encrypt"]);
  const json = JSON.stringify(lockedPlaintextAsJson(plaintext));
  const encryptedBoard = await encryptAesGcm(key, new TextEncoder().encode(json));
  const files: LockedSharePackage["files"] = [];
  const envelopeImages: EncryptedBoardEnvelope["images"] = [];
  for (const image of images) {
    const encrypted = await encryptAesGcm(key, image.bytes);
    files.push({ id: image.id, data: encrypted.data });
    envelopeImages.push({
      id: image.id,
      pageId: image.pageId,
      key: "",
      url: "",
      iv: encrypted.iv,
      size: encrypted.data.byteLength,
    });
  }
  return {
    envelope: {
      id: plaintext.id,
      encrypted: true,
      v: 1,
      kdf: "PBKDF2-SHA-256",
      iterations: LOCKED_SHARE_ITERATIONS,
      salt: bytesToBase64Url(salt),
      iv: encryptedBoard.iv,
      data: bytesToBase64Url(encryptedBoard.data),
      images: envelopeImages,
      createdAt: plaintext.createdAt,
    },
    files,
  };
}

async function decryptImage(
  key: CryptoKey,
  envelope: EncryptedBoardEnvelope,
  item: ShareRequestItem & { type: "image" },
): Promise<DraftImageItem | null> {
  const encrypted = envelope.images.find((image) => image.id === item.id);
  if (!encrypted?.url) return null;
  const res = await fetch(encrypted.url);
  if (!res.ok) throw new Error("Could not load encrypted image");
  const bytes = await decryptAesGcm(key, encrypted.iv, new Uint8Array(await res.arrayBuffer()));
  const mimeType = sniffRasterImageMime(bytes);
  if (!mimeType) return null;
  const file = new File([bytes], `${item.id}.${mimeType.slice("image/".length)}`, { type: mimeType });
  const image: DraftImageItem = { ...item, mimeType, size: file.size, file, previewUrl: URL.createObjectURL(file) };
  return image;
}

export async function decryptLockedBoard(
  envelope: EncryptedBoardEnvelope,
  pin: string,
): Promise<{ canvas: Board; dispose: () => void }> {
  const key = await deriveAesGcmKey(cleanPin(pin), base64UrlToBytes(envelope.salt), envelope.iterations, ["decrypt"]);
  const plaintext = parseJson(new TextDecoder().decode(await decryptAesGcm(key, envelope.iv, envelope.data)));
  const board = sanitizeLockedPlaintext(plaintext);
  if (!board) throw new Error("Invalid locked board");

  const decryptedPages: Board["pages"] = [];
  try {
    for (const page of board.pages) {
      const items: BoardItem[] = [];
      decryptedPages.push({ ...page, items });
      for (const item of page.items) {
        const decrypted = item.type === "image" ? await decryptImage(key, envelope, item) : item;
        if (decrypted) items.push(decrypted);
      }
    }
  } catch (error) {
    revokeDraftImagePreviews(decryptedPages);
    throw error;
  }
  const canvasPages = decryptedPages.map((page) => ({ ...page, layouts: layoutsForItems(page.layouts, page.items) }));
  return {
    canvas: { ...board, id: envelope.id, pages: canvasPages },
    dispose: () => revokeDraftImagePreviews(decryptedPages),
  };
}
