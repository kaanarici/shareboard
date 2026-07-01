import {
  LOCKED_SHARE_ITERATIONS,
  base64UrlToBytes,
  bytesToBase64Url,
} from "@/lib/encrypted-share";
import { sanitizePublicCanvasManifest, sanitizeTinyCanvas } from "@/lib/canvas-sanitize";
import type { Canvas } from "@/lib/types";

export const HANDOFF_CODE_LENGTH = 12;
export const HANDOFF_CODE_GROUP_SIZE = 4;
export const HANDOFF_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
// 31^12 is ~59.5 bits; 100k PBKDF2-SHA-256 rounds make offline brute-force
// computationally infeasible for a one-hour, one-time handoff payload.
export const HANDOFF_KDF_ITERATIONS = LOCKED_SHARE_ITERATIONS;

const HANDOFF_CODE_PATTERN = new RegExp(
  `^[${HANDOFF_CODE_ALPHABET}]{${HANDOFF_CODE_LENGTH}}$`
);
const STORAGE_ID_PREFIX = "shareboard-handoff-id:";
const STORAGE_ID_BYTES = 32;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type HandoffPackage = {
  code: string;
  storageId: string;
  ciphertext: string;
  iv: string;
  salt: string;
};

type BytesInput = string | Uint8Array<ArrayBuffer>;

function asBytes(value: BytesInput): Uint8Array<ArrayBuffer> {
  return typeof value === "string" ? base64UrlToBytes(value) : value;
}

function isBase64UrlBytes(value: unknown, bytes: number) {
  if (typeof value !== "string" || !BASE64URL_PATTERN.test(value)) return false;
  try {
    return base64UrlToBytes(value).byteLength === bytes;
  } catch {
    return false;
  }
}

function sanitizeHandoffCanvas(value: unknown): Canvas | null {
  return (
    sanitizePublicCanvasManifest(value) ??
    sanitizeTinyCanvas(value)
  );
}

async function deriveHandoffKey(
  code: string,
  salt: BytesInput,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  const normalized = normalizeHandoffCode(code);
  if (!normalized) throw new Error("Invalid handoff code");
  const saltBytes = asBytes(salt);
  if (saltBytes.byteLength !== SALT_BYTES) throw new Error("Invalid handoff salt");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalized),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: HANDOFF_KDF_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages
  );
}

export function normalizeHandoffCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.replace(/[\s-]+/g, "").toUpperCase();
  return HANDOFF_CODE_PATTERN.test(code) ? code : null;
}

export function formatHandoffCode(code: string): string {
  const normalized = normalizeHandoffCode(code);
  if (!normalized) throw new Error("Invalid handoff code");
  return normalized.match(new RegExp(`.{1,${HANDOFF_CODE_GROUP_SIZE}}`, "g"))!.join("-");
}

export function isHandoffCode(value: unknown): value is string {
  return normalizeHandoffCode(value) !== null;
}

export function isHandoffStorageId(value: unknown): value is string {
  return isBase64UrlBytes(value, STORAGE_ID_BYTES);
}

export function generateHandoffCode() {
  const max = Math.floor(256 / HANDOFF_CODE_ALPHABET.length) * HANDOFF_CODE_ALPHABET.length;
  const bytes = new Uint8Array(HANDOFF_CODE_LENGTH);
  let code = "";

  while (code.length < HANDOFF_CODE_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= max) continue;
      code += HANDOFF_CODE_ALPHABET[byte % HANDOFF_CODE_ALPHABET.length];
      if (code.length === HANDOFF_CODE_LENGTH) break;
    }
  }

  return code;
}

export async function createHandoffStorageId(code: string): Promise<string> {
  const normalized = normalizeHandoffCode(code);
  if (!normalized) throw new Error("Invalid handoff code");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${STORAGE_ID_PREFIX}${normalized}`));
  return bytesToBase64Url(new Uint8Array(digest));
}

export async function createHandoffPackage(canvas: Canvas): Promise<HandoffPackage> {
  const safeCanvas = sanitizeHandoffCanvas(canvas);
  if (!safeCanvas) throw new Error("Invalid handoff board");

  const code = generateHandoffCode();
  const storageId = await createHandoffStorageId(code);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveHandoffKey(code, salt, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(safeCanvas))
  );

  return {
    code,
    storageId,
    ciphertext: bytesToBase64Url(new Uint8Array(encrypted)),
    iv: bytesToBase64Url(iv),
    salt: bytesToBase64Url(salt),
  };
}

export function encodeHandoffUrl(origin: string, code: string) {
  return `${origin.replace(/\/+$/, "")}/h#c=${formatHandoffCode(code)}`;
}

export function parseHandoffFragment(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return normalizeHandoffCode(params.get("c"));
}

export async function decryptHandoff(
  ciphertext: BytesInput,
  code: string,
  iv: string,
  salt: string
): Promise<Canvas | null> {
  try {
    const cryptoKey = await deriveHandoffKey(code, salt, ["decrypt"]);
    const ivBytes = asBytes(iv);
    if (ivBytes.byteLength !== IV_BYTES) return null;
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      cryptoKey,
      asBytes(ciphertext)
    );
    return sanitizeHandoffCanvas(JSON.parse(decoder.decode(decrypted)));
  } catch {
    return null;
  }
}
