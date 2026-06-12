import { nanoid } from "nanoid";
import type { BoardOrigin } from "@/lib/board-origin";
import {
  isDraftImageItem,
  type BoardPage,
  type CanvasItem,
  type GenerateResponse,
  type GridLayouts,
} from "@/lib/types";

const DB_NAME = "shareboard";
const DRAFT_STORE = "drafts";
const LIBRARY_STORE = "library";
const KEY = "current";
const DB_VERSION = 2;
const MAX_LIBRARY_BOARDS = 20;

interface StoredPage {
  id: string;
  layouts: GridLayouts;
  items: unknown[];
}

interface StoredDraft {
  v: 2;
  generation: GenerateResponse | null;
  pages: StoredPage[];
  boardOrigin?: BoardOrigin;
}

interface DraftSnapshot {
  pages: BoardPage[];
  generation: GenerateResponse | null;
  boardOrigin: BoardOrigin;
}

interface DraftSerializationAdapter {
  createPreviewUrl(file: File): string;
  isFile(value: unknown): value is File;
}

interface DraftStoreAdapter {
  available: boolean;
  load(): Promise<StoredDraft | undefined>;
  save(snapshot: StoredDraft): Promise<void>;
  clear(): Promise<void>;
}

const browserSerializationAdapter: DraftSerializationAdapter = {
  createPreviewUrl(file) {
    return URL.createObjectURL(file);
  },
  isFile(value): value is File {
    return value instanceof File;
  },
};

function hasIndexedDb() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

interface UpgradeContext {
  has(name: string): boolean;
  create(name: string, options?: IDBObjectStoreParameters): void;
}

/**
 * v2 adds the library store next to the v1 draft store. The guarded creates
 * leave an existing draft store — and its "current" autosave key — untouched on
 * upgrade; only the missing store is created.
 */
function ensureObjectStores(ctx: UpgradeContext) {
  if (!ctx.has(DRAFT_STORE)) ctx.create(DRAFT_STORE);
  if (!ctx.has(LIBRARY_STORE)) ctx.create(LIBRARY_STORE, { keyPath: "id" });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      ensureObjectStores({
        has: (name) => db.objectStoreNames.contains(name),
        create: (name, options) => db.createObjectStore(name, options),
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      tx.oncomplete = () => resolve(req && "result" in req ? (req.result as T) : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function createIndexedDbDraftStore(): DraftStoreAdapter {
  return {
    available: hasIndexedDb(),
    async load() {
      return withStore<StoredDraft | undefined>(DRAFT_STORE, "readonly", (store) => store.get(KEY));
    },
    async save(snapshot) {
      await withStore(DRAFT_STORE, "readwrite", (store) => {
        store.put(snapshot, KEY);
      });
    },
    async clear() {
      await withStore(DRAFT_STORE, "readwrite", (store) => {
        store.delete(KEY);
      });
    },
  };
}

const indexedDbDraftStore = createIndexedDbDraftStore();

/**
 * Strip transient fields that don't survive serialization (blob: previewUrls).
 * The File handle structured-clones into IDB natively, so we keep it; on load
 * we reconstruct the previewUrl from the file.
 */
function stripForStorage(items: CanvasItem[]): unknown[] {
  return items.map((item) => {
    if (isDraftImageItem(item)) {
      const { previewUrl: _ignored, ...rest } = item;
      return rest;
    }
    return item;
  });
}

function stripLayoutsForStorage(layouts: GridLayouts): GridLayouts {
  const clean = (items: GridLayouts["lg"] = []) =>
    items.map(({ i, x, y, w, h, minW, maxW, minH, maxH }) => ({
      i,
      x,
      y,
      w,
      h,
      ...(minW != null && { minW }),
      ...(maxW != null && { maxW }),
      ...(minH != null && { minH }),
      ...(maxH != null && { maxH }),
    }));
  return { lg: clean(layouts.lg), sm: clean(layouts.sm) };
}

function rehydrate(items: unknown[], adapter: DraftSerializationAdapter): CanvasItem[] {
  const out: CanvasItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item.type === "image" && adapter.isFile(item.file)) {
      out.push({ ...item, previewUrl: adapter.createPreviewUrl(item.file) } as CanvasItem);
    } else {
      out.push(item as unknown as CanvasItem);
    }
  }
  return out;
}

function createStoredDraftSnapshot(
  pages: BoardPage[],
  generation: GenerateResponse | null,
  boardOrigin: BoardOrigin = { kind: "draft" },
): StoredDraft {
  return {
    v: 2,
    generation,
    pages: pages.map((page) => ({
      ...page,
      layouts: stripLayoutsForStorage(page.layouts),
      items: stripForStorage(page.items),
    })),
    boardOrigin,
  };
}

function restoreStoredDraftSnapshot(
  raw: StoredDraft | undefined,
  adapter: DraftSerializationAdapter = browserSerializationAdapter,
): DraftSnapshot | null {
  if (!raw || raw.v !== 2 || !Array.isArray(raw.pages) || raw.pages.length === 0) return null;
  return {
    pages: raw.pages.map((page) => ({
      id: page.id,
      layouts: page.layouts ?? { lg: [], sm: [] },
      items: rehydrate(page.items ?? [], adapter),
    })),
    generation: raw.generation ?? null,
    boardOrigin: raw.boardOrigin ?? { kind: "draft" },
  };
}

export async function saveLocalDraft(
  pages: BoardPage[],
  generation: GenerateResponse | null,
  boardOrigin: BoardOrigin = { kind: "draft" },
): Promise<void> {
  if (!indexedDbDraftStore.available) throw new Error("Local storage unavailable");
  const snapshot = createStoredDraftSnapshot(pages, generation, boardOrigin);
  await indexedDbDraftStore.save(snapshot);
}

export async function loadLocalDraft(): Promise<DraftSnapshot | null> {
  if (!indexedDbDraftStore.available) return null;
  try {
    const raw = await indexedDbDraftStore.load();
    return restoreStoredDraftSnapshot(raw, browserSerializationAdapter);
  } catch {
    return null;
  }
}

export async function clearLocalDraft(): Promise<void> {
  if (!indexedDbDraftStore.available) return;
  try {
    await indexedDbDraftStore.clear();
  } catch {
    /* ignore */
  }
}

/**
 * Stable signature of the editable state used to detect whether a draft is in
 * sync with what's persisted. Excludes blob bytes (a File reference identifies
 * the image; same reference ⇒ same image). Layouts are intentionally excluded:
 * react-grid-layout emits subtly-different floating-point coordinates as the
 * canvas re-measures, which would oscillate the signature and thrash the
 * auto-save effect. Layout state still rides along in saveLocalDraft as part
 * of the page payload — it just doesn't drive the dirty check on its own.
 */
export function draftSignature(
  pages: BoardPage[],
  generation: GenerateResponse | null,
  boardOrigin: BoardOrigin = { kind: "draft" },
): string {
  return JSON.stringify({
    o: boardOrigin,
    g: generation,
    p: pages.map((page) => ({
      id: page.id,
      i: page.items.map((item) => {
        if (isDraftImageItem(item)) {
          return {
            t: "draft_image",
            id: item.id,
            n: item.file.name,
            s: item.size ?? item.file.size,
            m: item.mimeType ?? item.file.type,
            c: item.caption,
            a: item.aspect,
          };
        }
        return item;
      }),
    })),
  });
}

export function draftLayoutSignature(pages: BoardPage[]): string {
  const clean = (items: GridLayouts["lg"] = []) =>
    items.map(({ i, x, y, w, h, minW, maxW, minH, maxH }) => ({
      i,
      x,
      y,
      w,
      h,
      ...(minW != null && { minW }),
      ...(maxW != null && { maxW }),
      ...(minH != null && { minH }),
      ...(maxH != null && { maxH }),
    }));
  return JSON.stringify({
    p: pages.map((page) => ({
      id: page.id,
      l: {
        lg: clean(page.layouts.lg),
        sm: clean(page.layouts.sm),
      },
    })),
  });
}

/* ─── Library: multiple named boards saved on this device ─────────────── */

export interface LibraryBoardMeta {
  id: string;
  name: string;
  savedAt: number;
}

interface LibraryBoardRecord extends LibraryBoardMeta {
  snapshot: StoredDraft;
}

interface LibraryStoreAdapter {
  available: boolean;
  list(): Promise<LibraryBoardRecord[]>;
  get(id: string): Promise<LibraryBoardRecord | undefined>;
  put(record: LibraryBoardRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

function createIndexedDbLibraryStore(): LibraryStoreAdapter {
  return {
    available: hasIndexedDb(),
    async list() {
      return (await withStore<LibraryBoardRecord[]>(LIBRARY_STORE, "readonly", (store) => store.getAll())) ?? [];
    },
    async get(id) {
      return withStore<LibraryBoardRecord | undefined>(LIBRARY_STORE, "readonly", (store) => store.get(id));
    },
    async put(record) {
      await withStore(LIBRARY_STORE, "readwrite", (store) => {
        store.put(record);
      });
    },
    async delete(id) {
      await withStore(LIBRARY_STORE, "readwrite", (store) => {
        store.delete(id);
      });
    },
  };
}

const indexedDbLibraryStore = createIndexedDbLibraryStore();

function toLibraryMeta({ id, name, savedAt }: LibraryBoardRecord): LibraryBoardMeta {
  return { id, name, savedAt };
}

/**
 * Snapshot the current board as a named library entry (reusing the draft
 * serializer so File handles survive), then evict the oldest entries past
 * MAX_LIBRARY_BOARDS. Returns the saved metadata plus anything evicted so the
 * caller can report what was dropped.
 */
async function putLibraryBoard(
  store: LibraryStoreAdapter,
  input: { id: string; name: string; savedAt: number; pages: BoardPage[]; generation: GenerateResponse | null },
): Promise<{ saved: LibraryBoardMeta; evicted: LibraryBoardMeta[] }> {
  const record: LibraryBoardRecord = {
    id: input.id,
    name: input.name,
    savedAt: input.savedAt,
    snapshot: createStoredDraftSnapshot(input.pages, input.generation, { kind: "draft" }),
  };
  await store.put(record);

  const sorted = (await store.list()).sort((a, b) => b.savedAt - a.savedAt);
  const evicted: LibraryBoardMeta[] = [];
  for (const old of sorted.slice(MAX_LIBRARY_BOARDS)) {
    await store.delete(old.id);
    evicted.push(toLibraryMeta(old));
  }
  return { saved: toLibraryMeta(record), evicted };
}

async function listLibrary(store: LibraryStoreAdapter): Promise<LibraryBoardMeta[]> {
  return (await store.list()).map(toLibraryMeta).sort((a, b) => b.savedAt - a.savedAt);
}

async function openLibrary(
  store: LibraryStoreAdapter,
  id: string,
  adapter: DraftSerializationAdapter = browserSerializationAdapter,
): Promise<DraftSnapshot | null> {
  const record = await store.get(id);
  if (!record) return null;
  return restoreStoredDraftSnapshot(record.snapshot, adapter);
}

export async function saveBoardToLibrary(
  name: string,
  pages: BoardPage[],
  generation: GenerateResponse | null,
): Promise<{ saved: LibraryBoardMeta; evicted: LibraryBoardMeta[] }> {
  if (!indexedDbLibraryStore.available) throw new Error("Local storage unavailable");
  return putLibraryBoard(indexedDbLibraryStore, {
    id: nanoid(12),
    name,
    savedAt: Date.now(),
    pages,
    generation,
  });
}

export async function listLibraryBoards(): Promise<LibraryBoardMeta[]> {
  if (!indexedDbLibraryStore.available) return [];
  try {
    return await listLibrary(indexedDbLibraryStore);
  } catch {
    return [];
  }
}

export async function openLibraryBoard(id: string): Promise<DraftSnapshot | null> {
  if (!indexedDbLibraryStore.available) return null;
  try {
    return await openLibrary(indexedDbLibraryStore, id);
  } catch {
    return null;
  }
}

export async function deleteLibraryBoard(id: string): Promise<void> {
  if (!indexedDbLibraryStore.available) return;
  try {
    await indexedDbLibraryStore.delete(id);
  } catch {
    /* ignore */
  }
}

export const __draftPolicyForTests = {
  createStoredDraftSnapshot,
  restoreStoredDraftSnapshot,
  stripLayoutsForStorage,
  stripForStorage,
  rehydrate,
};

export const __libraryPolicyForTests = {
  ensureObjectStores,
  putLibraryBoard,
  listLibrary,
  openLibrary,
  toLibraryMeta,
  MAX_LIBRARY_BOARDS,
};
