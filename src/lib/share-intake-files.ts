const DB_NAME = "shareboard-intake";
const DB_VERSION = 1;
const STORE = "shared";

interface SharedFilePart {
  blob?: unknown;
  name?: unknown;
  type?: unknown;
  lastModified?: unknown;
}

interface SharedIntakeRow {
  files?: unknown;
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
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
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && "result" in req ? (req.result as T) : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function fileFromPart(part: SharedFilePart, index: number): File | null {
  if (!(part.blob instanceof Blob)) return null;
  const type = typeof part.type === "string" && part.type.startsWith("image/") ? part.type : part.blob.type;
  if (!type.startsWith("image/")) return null;
  const name = typeof part.name === "string" && part.name.trim() ? part.name : `shared-image-${index + 1}`;
  const lastModified = typeof part.lastModified === "number" ? part.lastModified : Date.now();
  return new File([part.blob], name, { type, lastModified });
}

export function sharedRowsToFiles(rows: unknown[]): File[] {
  const files: File[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rawFiles = (row as SharedIntakeRow).files;
    if (!Array.isArray(rawFiles)) continue;
    for (const part of rawFiles) {
      if (!part || typeof part !== "object") continue;
      const file = fileFromPart(part as SharedFilePart, files.length);
      if (file) files.push(file);
    }
  }
  return files;
}

export async function readSharedImageFiles(): Promise<File[]> {
  if (!hasIndexedDb()) return [];
  try {
    const rows = await withStore<unknown[]>("readonly", (store) => store.getAll());
    return sharedRowsToFiles(rows ?? []);
  } catch {
    return [];
  }
}

export async function clearSharedImageFiles(): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    await withStore("readwrite", (store) => {
      store.clear();
    });
  } catch {}
}
