import { sanitizePublicCanvasManifest } from "@/lib/canvas-sanitize";
import {
  createHandoffStorageId,
  decryptHandoff,
  normalizeHandoffCode,
  parseHandoffFragment,
} from "@/lib/handoff";
import { storedBoardFetchUrl } from "@/lib/shared-board";
import { decodeTinyShare, readStoredShareId, readTinyPayloadFromUrl } from "@/lib/tiny-share";
import { isEncryptedCanvas, type Canvas } from "@/lib/types";

export type ImportError =
  | "invalid-input"
  | "tiny-decode-failed"
  | "fetch-failed"
  | "handoff-gone"
  | "locked"
  | "unreadable"
  | "wrong-pin";

export type ImportResult =
  | { ok: true; canvas: Canvas; dispose?: () => void }
  | { ok: false; error: ImportError };

/**
 * Resolve a pasted Shareboard URL or tiny-fragment into a Canvas. Handles tiny
 * (decoded client-side) and stored (fetched + sanitized) shares. Locked shares
 * fall through with `error: "locked"` — caller is expected to prompt for a pin
 * and call {@link unlockSharedBoard} instead.
 */
export async function importFromUrl(raw: string): Promise<ImportResult> {
  const input = raw.trim();
  if (!input) return { ok: false, error: "invalid-input" };

  const handoffCode = readHandoffCode(input);
  if (handoffCode) return importHandoff(handoffCode);

  const tinyPayload = readTinyPayloadFromUrl(input);
  if (tinyPayload) {
    const canvas = await decodeTinyShare(tinyPayload).catch(() => null);
    return canvas ? { ok: true, canvas } : { ok: false, error: "tiny-decode-failed" };
  }

  const storedId = readStoredShareId(input);
  if (!storedId) return { ok: false, error: "invalid-input" };
  return fetchStoredCanvas(storedId);
}

/**
 * A bare handoff code (typed into the Import dialog) or a `/h#c=<code>` link.
 * The code is the only decryption secret, so we derive the storage id from it
 * locally and only ever send that hash to the server — never the code itself.
 */
function readHandoffCode(input: string): string | null {
  const hashIndex = input.indexOf("#");
  if (hashIndex >= 0) {
    const fromFragment = parseHandoffFragment(input.slice(hashIndex));
    if (fromFragment) return fromFragment;
  }
  return normalizeHandoffCode(input);
}

async function importHandoff(code: string): Promise<ImportResult> {
  const storageId = await createHandoffStorageId(code);
  let res: Response;
  try {
    res = await fetch(`/api/handoff?id=${encodeURIComponent(storageId)}`);
  } catch {
    return { ok: false, error: "fetch-failed" };
  }
  // 404 is the one-time/expired/not-found outcome; the server deletes the
  // object on first successful read, so a second open lands here too.
  if (res.status === 404) return { ok: false, error: "handoff-gone" };
  if (!res.ok) return { ok: false, error: "fetch-failed" };

  const body = (await res.json().catch(() => null)) as
    | { ciphertext?: unknown; iv?: unknown; salt?: unknown }
    | null;
  if (
    !body ||
    typeof body.ciphertext !== "string" ||
    typeof body.iv !== "string" ||
    typeof body.salt !== "string"
  ) {
    return { ok: false, error: "handoff-gone" };
  }

  const canvas = await decryptHandoff(body.ciphertext, code, body.iv, body.salt);
  return canvas ? { ok: true, canvas } : { ok: false, error: "handoff-gone" };
}

export async function fetchStoredCanvas(id: string): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch(storedBoardFetchUrl(id));
  } catch {
    return { ok: false, error: "fetch-failed" };
  }
  if (!res.ok) return { ok: false, error: "fetch-failed" };
  const body = (await res.json().catch(() => null)) as unknown;
  if (body && typeof body === "object" && (body as { locked?: unknown }).locked === true) {
    return { ok: false, error: "locked" };
  }
  const canvas = sanitizePublicCanvasManifest(body);
  return canvas ? { ok: true, canvas } : { ok: false, error: "unreadable" };
}

/**
 * Unlock + decrypt a locked share. Server returns the encrypted envelope (sans
 * verification material); the actual decryption happens client-side. The
 * returned `dispose` should be called when the resulting canvas is no longer
 * rendered, so the blob: URLs holding decrypted image bytes can be revoked.
 */
export async function unlockSharedBoard(id: string, pin: string): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch("/api/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "unlock", id, pin }),
    });
  } catch {
    return { ok: false, error: "fetch-failed" };
  }
  if (res.status === 403) return { ok: false, error: "wrong-pin" };
  if (!res.ok) return { ok: false, error: "fetch-failed" };
  const body = (await res.json().catch(() => null)) as unknown;
  if (!isEncryptedCanvas(body)) return { ok: false, error: "unreadable" };
  try {
    const { decryptLockedCanvas } = await import("@/lib/encrypted-share");
    const { canvas, dispose } = await decryptLockedCanvas(body, pin);
    return { ok: true, canvas, dispose };
  } catch {
    return { ok: false, error: "wrong-pin" };
  }
}
