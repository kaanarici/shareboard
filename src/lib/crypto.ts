export const LOCKED_SHARE_PIN_LENGTH = 6;
export const LOCKED_SHARE_ITERATIONS = 100_000;

export function bytesToBase64Url(bytes: Uint8Array<ArrayBuffer>) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function cleanPin(value: string) {
  return value.replace(/\D/g, "").slice(0, LOCKED_SHARE_PIN_LENGTH);
}

export function isCompletePin(value: string) {
  return cleanPin(value).length === LOCKED_SHARE_PIN_LENGTH;
}

const encoder = new TextEncoder();

export async function deriveAesGcmKey(
  secret: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

export async function encryptAesGcm(
  key: CryptoKey,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<{ iv: string; data: Uint8Array<ArrayBuffer> }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
  return { iv: bytesToBase64Url(iv), data: new Uint8Array(encrypted) };
}

export async function decryptAesGcm(
  key: CryptoKey,
  iv: string,
  data: string | Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const encrypted = data instanceof Uint8Array ? data : base64UrlToBytes(data);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(iv) },
    key,
    encrypted,
  );
  return new Uint8Array(decrypted);
}
