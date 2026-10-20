import { LOCKED_SHARE_ITERATIONS, base64UrlToBytes, bytesToBase64Url, deriveAesGcmKey } from "@/lib/crypto";
import { boardAsJson, sanitizeTextBoard } from "@/lib/canvas-sanitize";
import { parseJson } from "@/lib/json";
import type { Board } from "@/lib/types";

export const HANDOFF_CODE_LENGTH = 12;
const HANDOFF_CODE_GROUP_SIZE = 4;
export const HANDOFF_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

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
  return value instanceof Uint8Array ? value : base64UrlToBytes(value);
}

function isBase64UrlBytes(value: string, bytes: number) {
  if (!BASE64URL_PATTERN.test(value)) return false;
  try {
    return base64UrlToBytes(value).byteLength === bytes;
  } catch {
    return false;
  }
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
  return deriveAesGcmKey(normalized, saltBytes, LOCKED_SHARE_ITERATIONS, usages);
}

export function normalizeHandoffCode(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const code = input.replace(/[\s-]+/g, "").toUpperCase();
  return HANDOFF_CODE_PATTERN.test(code) ? code : null;
}

export function formatHandoffCode(code: string): string {
  const normalized = normalizeHandoffCode(code);
  if (!normalized) throw new Error("Invalid handoff code");
  const groups: string[] = [];
  for (let index = 0; index < normalized.length; index += HANDOFF_CODE_GROUP_SIZE) {
    groups.push(normalized.slice(index, index + HANDOFF_CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

export function isHandoffStorageId(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && isBase64UrlBytes(value, STORAGE_ID_BYTES);
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

export async function createHandoffPackage(canvas: Board): Promise<HandoffPackage> {
  const safeCanvas = sanitizeTextBoard(boardAsJson(canvas));
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
): Promise<Board | null> {
  try {
    const cryptoKey = await deriveHandoffKey(code, salt, ["decrypt"]);
    const ivBytes = asBytes(iv);
    if (ivBytes.byteLength !== IV_BYTES) return null;
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      cryptoKey,
      asBytes(ciphertext)
    );
    return sanitizeTextBoard(parseJson(decoder.decode(decrypted)));
  } catch {
    return null;
  }
}
