import { boardAsJson, sanitizeStoredBoard } from "@/lib/canvas-sanitize";
import { isRecord, parseJson, readString } from "@/lib/json";
import { objectKeyFromUrl } from "@/lib/storage-keys";
import { HttpError } from "@/lib/server/http";
import { lockedManifestKey } from "@/lib/server/locked-share";
import { deleteObjects, deleteObjectsQuietly, getObjectText, putObject, type WriteCondition } from "@/lib/server/storage";
import { parseEncryptedEnvelope } from "@/lib/locked-envelope";
import { isSharedImageItem, type Board, type EncryptedBoardEnvelope, type PinVerifier } from "@/lib/types";

interface ShareRecordBase {
  id: string;
  key: string;
  etag: string;
}

export interface PublicShareRecord extends ShareRecordBase {
  kind: "stored";
  board: Board;
}

export interface LockedShareRecord extends ShareRecordBase {
  kind: "locked";
  envelope: EncryptedBoardEnvelope;
  pinVerifier: PinVerifier | null;
}

export type ShareRecord = PublicShareRecord | LockedShareRecord;

export function publicManifestKey(id: string) {
  return `canvases/${id}.json`;
}

function readPinVerifier(value: unknown): PinVerifier | null {
  if (!isRecord(value) || value.kdf !== "PBKDF2-SHA-256") return null;
  const salt = readString(value.salt);
  const hash = readString(value.hash);
  const iterations = value.iterations;
  if (!salt || !hash || typeof iterations !== "number" || !Number.isSafeInteger(iterations)) return null;
  return { kdf: "PBKDF2-SHA-256", iterations, salt, hash };
}

export async function readPublicShare(id: string): Promise<PublicShareRecord | null> {
  const key = publicManifestKey(id);
  const stored = await getObjectText(key);
  if (!stored) return null;
  const value = parseJson(stored.text);
  const board = sanitizeStoredBoard(value);
  if (!board) return null;
  return { kind: "stored", id, key, etag: stored.etag, board };
}

export async function readLockedShare(id: string): Promise<LockedShareRecord | null> {
  const key = await lockedManifestKey(id);
  const stored = await getObjectText(key);
  if (!stored) return null;
  const value = parseJson(stored.text);
  const envelope = parseEncryptedEnvelope(value);
  if (!envelope || !isRecord(value) || envelope.id !== id) return null;
  return {
    kind: "locked",
    id,
    key,
    etag: stored.etag,
    envelope,
    pinVerifier: readPinVerifier(value.pinVerifier),
  };
}

export async function readShare(id: string): Promise<ShareRecord | null> {
  return (await readPublicShare(id)) ?? (await readLockedShare(id));
}

function shareObjectKeys(record: ShareRecord): Set<string> {
  if (record.kind === "locked") return new Set(record.envelope.images.map((image) => image.key));
  return boardObjectKeys(record.board);
}

export function boardObjectKeys(board: Board): Set<string> {
  const keys = new Set<string>();
  for (const page of board.pages) {
    for (const item of page.items) {
      if (isSharedImageItem(item)) keys.add(item.objectKey);
    }
  }
  const previewKey = board.previewUrl ? objectKeyFromUrl(board.previewUrl) : null;
  if (previewKey) keys.add(previewKey);
  return keys;
}

export function publicManifestJson(board: Board): string {
  return JSON.stringify(boardAsJson(board));
}

export function lockedManifestJson(envelope: EncryptedBoardEnvelope, pinVerifier: PinVerifier): string {
  return JSON.stringify({ ...envelope, pinVerifier });
}

export interface ShareCommit {
  key: string;
  json: string;
  nextObjectKeys: ReadonlySet<string>;
  prior?: ShareRecord;
}

export async function commitShare(commit: ShareCommit): Promise<void> {
  const condition: WriteCondition = commit.prior ? { kind: "etag", etag: commit.prior.etag } : { kind: "absent" };
  const written = await putObject(commit.key, commit.json, "application/json", condition);
  if (!written) {
    throw new HttpError(commit.prior ? "This share changed while you were updating it" : "Share id already exists", 409);
  }
  if (commit.prior) {
    const stale = [...shareObjectKeys(commit.prior)].filter((key) => !commit.nextObjectKeys.has(key));
    await deleteObjectsQuietly(stale);
  }
}

export async function deleteShare(record: ShareRecord): Promise<void> {
  await deleteObjects([record.key]);
  await deleteObjectsQuietly(shareObjectKeys(record));
}
