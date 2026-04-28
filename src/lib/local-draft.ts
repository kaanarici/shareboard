import type { BoardOrigin } from "@/components/use-share-flows";
import {
  isDraftImageItem,
  type BoardPage,
  type CanvasItem,
  type GenerateResponse,
  type GridLayouts,
} from "@/lib/types";

const DB_NAME = "shareboard";
const STORE = "drafts";
const KEY = "current";
const DB_VERSION = 1;

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

function hasIdb() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = fn(store);
      tx.oncomplete = () => resolve(req && "result" in req ? (req.result as T) : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

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

function rehydrate(items: unknown[]): CanvasItem[] {
  const out: CanvasItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item.type === "image" && item.file instanceof File) {
      out.push({ ...item, previewUrl: URL.createObjectURL(item.file) } as CanvasItem);
    } else {
      out.push(item as unknown as CanvasItem);
    }
  }
  return out;
}

export async function saveLocalDraft(
  pages: BoardPage[],
  generation: GenerateResponse | null,
  boardOrigin: BoardOrigin = { kind: "draft" },
): Promise<void> {
  if (!hasIdb()) throw new Error("Local storage unavailable");
  const snapshot: StoredDraft = {
    v: 2,
    generation,
    pages: pages.map((page) => ({
      ...page,
      items: stripForStorage(page.items),
    })),
    boardOrigin,
  };
  await withStore("readwrite", (store) => {
    store.put(snapshot, KEY);
  });
}

export async function loadLocalDraft(): Promise<{
  pages: BoardPage[];
  generation: GenerateResponse | null;
  boardOrigin: BoardOrigin;
} | null> {
  if (!hasIdb()) return null;
  try {
    const raw = await withStore<StoredDraft | undefined>("readonly", (store) => store.get(KEY));
    if (!raw || raw.v !== 2 || !Array.isArray(raw.pages) || raw.pages.length === 0) return null;
    return {
      pages: raw.pages.map((page) => ({
        id: page.id,
        layouts: page.layouts ?? { lg: [], sm: [] },
        items: rehydrate(page.items ?? []),
      })),
      generation: raw.generation ?? null,
      boardOrigin: raw.boardOrigin ?? { kind: "draft" },
    };
  } catch {
    return null;
  }
}

export async function clearLocalDraft(): Promise<void> {
  if (!hasIdb()) return;
  try {
    await withStore("readwrite", (store) => {
      store.delete(KEY);
    });
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
