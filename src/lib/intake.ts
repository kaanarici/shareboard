import { withIdbStore, type IdbDatabase } from "@/lib/idb";
import { isRecord } from "@/lib/json";
import { isValidUrl } from "@/lib/platforms";
import {
  SHARE_PARAM_MAX,
  SHARE_TARGET_DB,
  SHARE_TARGET_DB_VERSION,
  SHARE_TARGET_IMAGE_TYPES,
  SHARE_TARGET_STORE,
} from "@/lib/share-target-contract";

export type ShareParams = { title?: string; text?: string; url?: string };

export type EditorSearch = ShareParams & {
  page?: number;
  shared?: "1" | "lost";
  intake?: string;
};

export type ShareIntake =
  | { kind: "url"; url: string }
  | { kind: "note"; text: string }
  | { kind: "svg"; file: File }
  | null;

export function shareParam(value: FormDataEntryValue | string | number | boolean | null | undefined): string | undefined {
  if (value instanceof File || value === null || value === undefined) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, SHARE_PARAM_MAX);
}

function firstHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/i);
  return match && isValidUrl(match[0]) ? match[0] : null;
}

export function resolveShareIntake({ title, text, url }: ShareParams): ShareIntake {
  const target = url && isValidUrl(url) ? url : text ? firstHttpUrl(text) : null;
  if (target) return { kind: "url", url: target };
  const note = text || title;
  return note ? { kind: "note", text: note } : null;
}

function findSvgSource(html: string | null, text: string | null) {
  return html?.match(/<svg[\s\S]*<\/svg>/i)?.[0] ?? (text?.startsWith("<svg") ? text : null);
}

function createSvgFile(svgSource: string) {
  const withXmlns = svgSource.includes("xmlns=")
    ? svgSource
    : svgSource.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return new File([withXmlns], `shareboard-${Date.now()}.svg`, { type: "image/svg+xml" });
}

function findSharedUrl(types: readonly string[], get: (type: string) => string) {
  const uriList = get("text/uri-list")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (uriList && isValidUrl(uriList)) return uriList;

  const text = get("text/plain").trim();
  if (text && isValidUrl(text)) return text;

  if (!types.includes("text/html")) return null;
  const html = get("text/html");
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const anchor = doc.querySelector("a[href]");
  if (!(anchor instanceof HTMLAnchorElement) || !isValidUrl(anchor.href)) return null;
  return anchor.href;
}

export function looksLikeImageFilename(text: string) {
  return /^[^/\n\r]+\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(text.trim());
}

export function looksLikeJsonFilename(text: string) {
  return /^[^/\n\r]+\.json$/i.test(text.trim());
}

export function filesFromTransfer(data: DataTransfer, accepts: (file: File) => boolean) {
  const files = Array.from(data.files).filter(accepts);
  const seen = new Set(files.map(fileIdentity));
  for (const item of Array.from(data.items)) {
    const file = item.getAsFile();
    if (!file || !accepts(file)) continue;
    const identity = fileIdentity(file);
    if (!seen.has(identity)) {
      seen.add(identity);
      files.push(file);
    }
  }
  return files;
}

function fileIdentity(file: File) {
  return [file.name, file.type, file.size, file.lastModified].join(":");
}

export function resolveClipboardIntake(clipboard: DataTransfer): ShareIntake {
  const html = clipboard.getData("text/html")?.trim() || null;
  const text = clipboard.getData("text/plain")?.trim() || null;
  const svgSource = findSvgSource(html, text);
  if (svgSource) return { kind: "svg", file: createSvgFile(svgSource) };
  const url = findSharedUrl(clipboard.types, (type) => clipboard.getData(type));
  if (url) return { kind: "url", url };
  if (text) return resolveShareIntake({ text });
  return null;
}

const SHARE_TARGET_IDB: IdbDatabase = {
  name: SHARE_TARGET_DB,
  version: SHARE_TARGET_DB_VERSION,
  upgrade(db) {
    if (!db.objectStoreNames.contains(SHARE_TARGET_STORE)) {
      db.createObjectStore(SHARE_TARGET_STORE, { keyPath: "id", autoIncrement: true });
    }
  },
};

function fileFromPart(part: unknown, index: number): File | null {
  if (!isRecord(part) || !(part.blob instanceof Blob)) return null;
  const declared = typeof part.type === "string" && part.type ? part.type : part.blob.type;
  if (!SHARE_TARGET_IMAGE_TYPES.includes(declared)) return null;
  const name = typeof part.name === "string" && part.name.trim() ? part.name : `shared-image-${index + 1}`;
  const lastModified = typeof part.lastModified === "number" && Number.isFinite(part.lastModified) ? part.lastModified : Date.now();
  return new File([part.blob], name, { type: declared, lastModified });
}

export function sharedRowsToFiles(rows: readonly unknown[]): File[] {
  const files: File[] = [];
  for (const row of rows) {
    if (!isRecord(row) || !Array.isArray(row.files)) continue;
    for (const part of row.files) {
      const file = fileFromPart(part, files.length);
      if (file) files.push(file);
    }
  }
  return files;
}

export async function readSharedImageFiles(): Promise<File[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const rows = await withIdbStore<unknown[]>(SHARE_TARGET_IDB, SHARE_TARGET_STORE, "readonly", (store) => store.getAll());
    return sharedRowsToFiles(rows ?? []);
  } catch {
    return [];
  }
}

export async function clearSharedImageFiles(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    await withIdbStore(SHARE_TARGET_IDB, SHARE_TARGET_STORE, "readwrite", (store) => {
      store.clear();
    });
  } catch {}
}
