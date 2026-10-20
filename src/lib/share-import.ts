import { isRecord, readResponseJson } from "@/lib/json";
import {
  createHandoffStorageId,
  decryptHandoff,
  normalizeHandoffCode,
  parseHandoffFragment,
} from "@/lib/handoff";
import { decryptLockedBoard } from "@/lib/encrypted-share";
import { parseEncryptedEnvelope } from "@/lib/locked-envelope";
import { parseBoardFetchResponse, storedBoardFetchUrl } from "@/lib/shared-board";
import { decodeTinyShare, readTinyPayloadFromUrl } from "@/lib/tiny-share";
import { isLockedBoardStub, type Board } from "@/lib/types";

type ImportError =
  | "invalid-input"
  | "tiny-decode-failed"
  | "fetch-failed"
  | "handoff-gone"
  | "locked"
  | "unreadable"
  | "wrong-pin";

export type ImportResult =
  | { ok: true; canvas: Board; dispose?: () => void }
  | { ok: false; error: ImportError };

export async function importBoard(raw: string): Promise<ImportResult> {
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
  return fetchStoredBoard(storedId);
}

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
  if (res.status === 404) return { ok: false, error: "handoff-gone" };
  if (!res.ok) return { ok: false, error: "fetch-failed" };

  const body = await readResponseJson(res);
  if (
    !isRecord(body) ||
    typeof body.ciphertext !== "string" ||
    typeof body.iv !== "string" ||
    typeof body.salt !== "string"
  ) {
    return { ok: false, error: "handoff-gone" };
  }

  const canvas = await decryptHandoff(body.ciphertext, code, body.iv, body.salt);
  return canvas ? { ok: true, canvas } : { ok: false, error: "handoff-gone" };
}

async function fetchStoredBoard(id: string): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch(storedBoardFetchUrl(id));
  } catch {
    return { ok: false, error: "fetch-failed" };
  }
  if (!res.ok) return { ok: false, error: "fetch-failed" };
  const board = parseBoardFetchResponse(await readResponseJson(res));
  if (!board) return { ok: false, error: "unreadable" };
  return isLockedBoardStub(board) ? { ok: false, error: "locked" } : { ok: true, canvas: board };
}

export async function unlockBoard(id: string, pin: string): Promise<ImportResult> {
  let res: Response;
  try {
    res = await fetch("/api/share/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, pin }),
    });
  } catch {
    return { ok: false, error: "fetch-failed" };
  }
  if (res.status === 403) return { ok: false, error: "wrong-pin" };
  if (!res.ok) return { ok: false, error: "fetch-failed" };
  const envelope = parseEncryptedEnvelope(await readResponseJson(res));
  if (!envelope) return { ok: false, error: "unreadable" };
  try {
    const { canvas, dispose } = await decryptLockedBoard(envelope, pin);
    return { ok: true, canvas, dispose };
  } catch {
    return { ok: false, error: "unreadable" };
  }
}

function readStoredShareId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, typeof window === "undefined" ? "http://localhost" : window.location.origin);
    return url.pathname.match(/\/c\/([A-Za-z0-9_-]+)\/?$/)?.[1] ?? null;
  } catch {
    return null;
  }
}
