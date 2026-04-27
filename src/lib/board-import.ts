import { sanitizePublicCanvasManifest } from "@/lib/canvas-sanitize";
import { decryptLockedCanvas } from "@/lib/encrypted-share";
import { decodeTinyShare, readStoredShareId, readTinyPayloadFromUrl } from "@/lib/tiny-share";
import { isEncryptedCanvas, type Canvas } from "@/lib/types";

export type ImportError =
  | "invalid-input"
  | "tiny-decode-failed"
  | "fetch-failed"
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

  const tinyPayload = readTinyPayloadFromUrl(input);
  if (tinyPayload) {
    const canvas = await decodeTinyShare(tinyPayload).catch(() => null);
    return canvas ? { ok: true, canvas } : { ok: false, error: "tiny-decode-failed" };
  }

  const storedId = readStoredShareId(input);
  if (!storedId) return { ok: false, error: "invalid-input" };
  return fetchStoredCanvas(storedId);
}

export async function fetchStoredCanvas(id: string): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch(`/api/share?key=${encodeURIComponent(`canvases/${id}.json`)}`);
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
    const { canvas, dispose } = await decryptLockedCanvas(body, pin);
    return { ok: true, canvas, dispose };
  } catch {
    return { ok: false, error: "wrong-pin" };
  }
}
