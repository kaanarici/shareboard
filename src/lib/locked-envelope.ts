import { isRecord, readPositiveInt, readString, readTrimmed } from "@/lib/json";
import { LIMITS } from "@/lib/limits";
import { isSafeObjectKey, objectUrl } from "@/lib/storage-keys";
import type { EncryptedBoardEnvelope, EncryptedShareImage } from "@/lib/types";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/;
const MB = 1024 * 1024;

function keepToken(value: unknown, max: number): string {
  const text = readString(value);
  return text && text.length <= max && TOKEN_PATTERN.test(text) ? text : "";
}

export function keepShareId(value: unknown): string {
  const id = keepToken(value, 80);
  return id.length >= 16 ? id : "";
}

function readEncryptedImage(value: unknown, stored: boolean): EncryptedShareImage | null {
  if (!isRecord(value)) return null;
  const id = readTrimmed(value.id, LIMITS.maxIdChars);
  const pageId = readTrimmed(value.pageId, LIMITS.maxIdChars);
  const iv = keepToken(value.iv, 128);
  const size = readPositiveInt(value.size);
  const key = stored ? readTrimmed(value.key, 240) : "";
  if (!id || !pageId || !iv || size === undefined) return null;
  if (stored && !(key.startsWith("locked-images/") && isSafeObjectKey(key))) return null;
  return { id, pageId, key, url: key ? objectUrl(key) : "", iv, size };
}

export function envelopeProblem(value: unknown, stored: boolean): string | EncryptedBoardEnvelope {
  if (!isRecord(value)) return "Invalid encrypted payload";
  const id = keepShareId(value.id);
  if (!id) return "Invalid encrypted board id";
  if (value.encrypted !== true || value.v !== 1 || value.kdf !== "PBKDF2-SHA-256") return "Invalid encrypted board";
  const iterations = value.iterations;
  if (typeof iterations !== "number" || !Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) {
    return "Invalid encryption settings";
  }
  const salt = keepToken(value.salt, 128);
  const iv = keepToken(value.iv, 128);
  const data = keepToken(value.data, LIMITS.maxPayloadChars);
  if (!salt || !iv || !data) return "Invalid encrypted board";
  const rawImages = Array.isArray(value.images) ? value.images : [];
  const images: EncryptedShareImage[] = [];
  for (const raw of rawImages) {
    const image = readEncryptedImage(raw, stored);
    if (!image || images.some((other) => other.id === image.id)) return "Invalid encrypted image";
    images.push(image);
  }
  if (images.length > LIMITS.maxImages) return `Too many images (max ${LIMITS.maxImages})`;
  const totalBytes = images.reduce((sum, image) => sum + image.size, 0);
  if (totalBytes > LIMITS.maxBoardImageBytes + images.length * 1024) {
    return `Images exceed ${LIMITS.maxBoardImageBytes / MB} MB total`;
  }
  return {
    id,
    encrypted: true,
    v: 1,
    kdf: "PBKDF2-SHA-256",
    iterations,
    salt,
    iv,
    data,
    images,
    createdAt: readTrimmed(value.createdAt, 40) || new Date().toISOString(),
  };
}

export function parseEncryptedEnvelope(value: unknown): EncryptedBoardEnvelope | null {
  const result = envelopeProblem(value, true);
  return typeof result === "string" ? null : result;
}

