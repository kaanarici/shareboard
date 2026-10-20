import { BOARDS_STORE, SHAREBOARD_DB } from "@/lib/local-draft";
import { withIdbStore } from "@/lib/idb";
import { isRecord, readTrimmed } from "@/lib/json";
import type { BoardOrigin, StoredShareKind } from "@/lib/types";

export const MAX_BOARDS = 32;

type BoardListKind = "tiny" | StoredShareKind;

export interface BoardListEntry {
  id: string;
  title: string;
  savedAt: number;
  kind: BoardListKind;
  shareUrl: string;
}

export type ShareRecordInput =
  | { kind: "tiny"; title: string; shareUrl: string; currentId: string | null }
  | { kind: StoredShareKind; title: string; shareUrl: string; currentId: string | null; id: string };

export function readBoardEntry(row: unknown): BoardListEntry | null {
  if (!isRecord(row)) return null;
  const { kind, savedAt } = row;
  if (kind !== "tiny" && kind !== "stored" && kind !== "locked") return null;
  const id = readTrimmed(row.id, 120);
  const title = readTrimmed(row.title, 200);
  const shareUrl = readTrimmed(row.shareUrl, 8000);
  if (!id || !title || !shareUrl || typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
  return { id, title, savedAt, kind, shareUrl };
}

function holdsLiveShare(entry: BoardListEntry): boolean {
  return entry.kind !== "tiny";
}

export function planShareRecord(
  entries: readonly BoardListEntry[],
  input: ShareRecordInput,
  now: number,
): { put: BoardListEntry; remove: string[] } {
  const current = entries.find((entry) => entry.id === input.currentId);
  const id = input.kind === "tiny" ? (current?.kind === "tiny" ? current.id : `tiny:${now}`) : input.id;
  const put: BoardListEntry = { id, title: input.title, savedAt: now, kind: input.kind, shareUrl: input.shareUrl };

  const remove: string[] = [];
  if (current && current.id !== id && !holdsLiveShare(current)) remove.push(current.id);

  const survivors = entries.filter((entry) => entry.id !== id && !remove.includes(entry.id));
  const disposable = survivors
    .filter((entry) => !holdsLiveShare(entry))
    .sort((a, b) => a.savedAt - b.savedAt);
  const overflow = survivors.length + 1 - MAX_BOARDS;
  for (const entry of disposable.slice(0, Math.max(0, overflow))) remove.push(entry.id);
  return { put, remove };
}

export async function listBoards(): Promise<BoardListEntry[]> {
  try {
    const rows = await withIdbStore<unknown[]>(SHAREBOARD_DB, BOARDS_STORE, "readonly", (store) => store.getAll());
    return (rows ?? [])
      .map(readBoardEntry)
      .filter((entry) => entry !== null)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function recordShare(input: ShareRecordInput): Promise<BoardListEntry> {
  const plan = planShareRecord(await listBoards(), input, Date.now());
  await withIdbStore(SHAREBOARD_DB, BOARDS_STORE, "readwrite", (store) => {
    for (const id of plan.remove) store.delete(id);
    store.put(plan.put);
  });
  return plan.put;
}

export async function deleteBoardEntry(id: string): Promise<void> {
  await withIdbStore(SHAREBOARD_DB, BOARDS_STORE, "readwrite", (store) => {
    store.delete(id);
  });
}

export function originFromBoardEntry(entry: BoardListEntry): BoardOrigin {
  return entry.kind === "tiny" ? { kind: "draft" } : { kind: entry.kind, id: entry.id };
}
