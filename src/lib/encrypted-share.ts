import { base64UrlToBytes, bytesToBase64Url } from "@/lib/base64url";
import { sanitizePublicCanvasManifest } from "@/lib/canvas-sanitize";
import type { Canvas, EncryptedCanvasEnvelope, EncryptedShareImage } from "@/lib/types";

export { base64UrlToBytes, bytesToBase64Url };

export const LOCKED_SHARE_PIN_LENGTH = 6;
export const LOCKED_SHARE_ITERATIONS = 100_000;

type EncryptedBytes = {
  iv: string;
  data: Uint8Array<ArrayBuffer>;
};

export type LockedImageUpload = {
  id: string;
  pageId: string;
  key: string;
  file: Blob;
};

export type LockedSharePackage = {
  envelope: Omit<EncryptedCanvasEnvelope, "deleteTokenHash">;
  files: Array<EncryptedBytes & { id: string; key: string }>;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createLockedShareId() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)));
}

export function cleanPin(value: string) {
  return value.replace(/\D/g, "").slice(0, LOCKED_SHARE_PIN_LENGTH);
}

export function isCompletePin(value: string) {
  return cleanPin(value).length === LOCKED_SHARE_PIN_LENGTH;
}

async function deriveKey(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(pin), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptBytes(key: CryptoKey, bytes: Uint8Array<ArrayBuffer>): Promise<EncryptedBytes> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: bytesToBase64Url(iv), data: new Uint8Array(encrypted) };
}

async function decryptBytes(
  key: CryptoKey,
  iv: string,
  data: string | Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const encrypted = typeof data === "string" ? base64UrlToBytes(data) : data;
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    key,
    encrypted
  );
  return new Uint8Array(decrypted);
}

export async function createLockedSharePackage(
  pin: string,
  canvas: Canvas,
  images: LockedImageUpload[]
): Promise<LockedSharePackage> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(cleanPin(pin), salt, LOCKED_SHARE_ITERATIONS);
  const encryptedCanvas = await encryptBytes(key, encoder.encode(JSON.stringify(canvas)));
  const files = await Promise.all(
    images.map(async (image) => {
      const data = await encryptBytes(key, new Uint8Array(await image.file.arrayBuffer()));
      return { id: image.id, key: image.key, ...data };
    })
  );

  return {
    envelope: {
      id: canvas.id,
      encrypted: true,
      v: 1,
      kdf: "PBKDF2-SHA-256",
      iterations: LOCKED_SHARE_ITERATIONS,
      salt: bytesToBase64Url(salt),
      iv: encryptedCanvas.iv,
      data: bytesToBase64Url(encryptedCanvas.data),
      images: images.map((image, index) => ({
        id: image.id,
        pageId: image.pageId,
        key: image.key,
        url: "",
        iv: files[index]!.iv,
        size: files[index]!.data.byteLength,
      })),
      createdAt: canvas.createdAt,
    },
    files,
  };
}

/**
 * Decrypts an envelope into a `Canvas` whose image items reference blob URLs.
 * Caller MUST invoke `dispose()` once the canvas is no longer rendered, or the
 * blob URLs will hold their decrypted bytes in memory until tab close.
 */
export async function decryptLockedCanvas(
  envelope: EncryptedCanvasEnvelope,
  pin: string
): Promise<{ canvas: Canvas; dispose: () => void }> {
  const key = await deriveKey(cleanPin(pin), base64UrlToBytes(envelope.salt), envelope.iterations);
  const canvasBytes = await decryptBytes(key, envelope.iv, envelope.data);
  const canvas = JSON.parse(decoder.decode(canvasBytes)) as unknown;
  const byId = new Map(envelope.images.map((image) => [image.id, image] as const));
  const objectUrls: string[] = [];

  await Promise.all(
    (canvas && typeof canvas === "object" && Array.isArray((canvas as { pages?: unknown }).pages)
      ? (canvas as Canvas).pages
      : []
    ).flatMap((page) =>
      page.items.map(async (item) => {
        if (item.type !== "image") return;
        const encrypted = byId.get(item.id);
        if (!encrypted) throw new Error("Missing encrypted image");
        const res = await fetch(encrypted.url);
        if (!res.ok) throw new Error("Could not load encrypted image");
        const bytes = await decryptBytes(
          key,
          encrypted.iv,
          new Uint8Array(await res.arrayBuffer())
        );
        const url = URL.createObjectURL(new Blob([bytes], { type: item.mimeType || "image/png" }));
        objectUrls.push(url);
        item.url = url;
      })
    )
  );

  const safeCanvas = sanitizePublicCanvasManifest(canvas, { allowBlobImageUrls: true });
  if (!safeCanvas) throw new Error("Invalid locked board");

  const dispose = () => {
    while (objectUrls.length) URL.revokeObjectURL(objectUrls.pop()!);
  };

  return { canvas: safeCanvas, dispose };
}

export function withImageUrls(
  envelope: EncryptedCanvasEnvelope,
  images: EncryptedShareImage[]
): EncryptedCanvasEnvelope {
  const urls = new Map(images.map((image) => [image.id, image.url]));
  return {
    ...envelope,
    images: envelope.images.map((image) => ({ ...image, url: urls.get(image.id) || image.url })),
  };
}
