import { layoutsAsJson, readImageFields, sanitizeLayouts, sanitizeStoredItem } from "@/lib/canvas-sanitize";
import { isRecord, readTrimmed, type JsonRecord } from "@/lib/json";
import { LIMITS } from "@/lib/limits";
import { withIdbStore, type IdbDatabase } from "@/lib/idb";
import { isDraftImageItem, type BoardItem, type BoardOrigin, type BoardPage, type DraftImageItem } from "@/lib/types";

const DRAFTS_STORE = "drafts";
export const BOARDS_STORE = "boards";
const CURRENT_KEY = "current";
const UNREADABLE_KEY = "unreadable";

export const SHAREBOARD_DB: IdbDatabase = {
  name: "shareboard",
  version: 4,
  upgrade(db) {
    if (!db.objectStoreNames.contains(DRAFTS_STORE)) db.createObjectStore(DRAFTS_STORE);
    if (!db.objectStoreNames.contains(BOARDS_STORE)) db.createObjectStore(BOARDS_STORE, { keyPath: "id" });
  },
};

export interface DraftSnapshot {
  pages: BoardPage[];
  boardOrigin: BoardOrigin;
  boardId: string | null;
}

export type DraftLoadResult =
  | { status: "loaded"; draft: DraftSnapshot }
  | { status: "empty" }
  | { status: "unavailable" };

type StoredItem = Exclude<BoardItem, DraftImageItem> | Omit<DraftImageItem, "previewUrl">;

export interface StoredDraft {
  v: 2;
  pages: Array<{ id: string; layouts: ReturnType<typeof layoutsAsJson>; items: StoredItem[] }>;
  boardOrigin: BoardOrigin;
  boardId?: string;
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function storedItem(item: BoardItem): StoredItem {
  if (!isDraftImageItem(item)) return item;
  const { previewUrl, ...rest } = item;
  return rest;
}

export function createStoredDraft(draft: DraftSnapshot): StoredDraft {
  const stored: StoredDraft = {
    v: 2,
    pages: draft.pages.map((page) => ({
      id: page.id,
      layouts: layoutsAsJson(sanitizeLayouts(page.layouts, page.items)),
      items: page.items.map(storedItem),
    })),
    boardOrigin: draft.boardOrigin,
  };
  if (draft.boardId) stored.boardId = draft.boardId;
  return stored;
}

function restoreDraftImage(value: JsonRecord, createPreviewUrl: (file: File) => string): DraftImageItem | null {
  const fields = readImageFields(value);
  if (!(value.file instanceof File) || !fields) return null;
  const item: DraftImageItem = { ...fields, file: value.file, previewUrl: createPreviewUrl(value.file) };
  const aspect = Number(value.aspect);
  if (Number.isFinite(aspect) && aspect > 0) item.aspect = aspect;
  return item;
}

function restoreOrigin(value: unknown): BoardOrigin {
  if (!isRecord(value) || (value.kind !== "stored" && value.kind !== "locked")) return { kind: "draft" };
  const id = readTrimmed(value.id, LIMITS.maxIdChars);
  return id ? { kind: value.kind, id } : { kind: "draft" };
}

export function restoreStoredDraft(
  raw: unknown,
  createPreviewUrl: (file: File) => string = (file) => URL.createObjectURL(file),
): DraftSnapshot | null {
  if (!isRecord(raw) || raw.v !== 2 || !Array.isArray(raw.pages)) return null;
  let storedItemCount = 0;
  const pages: BoardPage[] = [];
  for (const page of raw.pages) {
    if (!isRecord(page)) continue;
    const id = readTrimmed(page.id, LIMITS.maxIdChars);
    if (!id) continue;
    const rawItems = Array.isArray(page.items) ? page.items : [];
    storedItemCount += rawItems.length;
    const items: BoardItem[] = [];
    for (const rawItem of rawItems) {
      const item =
        isRecord(rawItem) && rawItem.type === "image" && "file" in rawItem
          ? restoreDraftImage(rawItem, createPreviewUrl)
          : sanitizeStoredItem(rawItem);
      if (item && !items.some((existing) => existing.id === item.id)) items.push(item);
    }
    pages.push({ id, items, layouts: sanitizeLayouts(page.layouts, items) });
  }
  const restoredItemCount = pages.reduce((sum, page) => sum + page.items.length, 0);
  if (pages.length === 0 || (storedItemCount > 0 && restoredItemCount === 0)) return null;
  const boardOrigin = restoreOrigin(raw.boardOrigin);
  const boardId = readTrimmed(raw.boardId, 120) || (boardOrigin.kind === "draft" ? null : boardOrigin.id);
  return { pages, boardOrigin, boardId };
}

async function readDraftRecord(key: string): Promise<unknown> {
  return withIdbStore<unknown>(SHAREBOARD_DB, DRAFTS_STORE, "readonly", (store) => store.get(key));
}

async function writeDraftRecord(key: string, value: unknown): Promise<void> {
  await withIdbStore(SHAREBOARD_DB, DRAFTS_STORE, "readwrite", (store) => {
    store.put(value, key);
  });
}

export async function loadLocalDraft(): Promise<DraftLoadResult> {
  if (!hasIndexedDb()) return { status: "unavailable" };
  let raw: unknown;
  try {
    raw = await readDraftRecord(CURRENT_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === undefined || raw === null) return { status: "empty" };
  const draft = restoreStoredDraft(raw);
  if (draft) return { status: "loaded", draft };
  try {
    await writeDraftRecord(UNREADABLE_KEY, raw);
    return { status: "empty" };
  } catch {
    return { status: "unavailable" };
  }
}

let queue: Promise<void> = Promise.resolve();

export function saveLocalDraft(draft: DraftSnapshot): Promise<void> {
  if (!hasIndexedDb()) return Promise.reject(new Error("Local storage unavailable"));
  const stored = createStoredDraft(draft);
  const write = queue.then(() => writeDraftRecord(CURRENT_KEY, stored));
  queue = write.catch(() => undefined);
  return write;
}
