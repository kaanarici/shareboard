import { isRecord, readString, readTrimmed, readPositiveInt, type JsonRecord } from "@/lib/json";
import { LIMITS } from "@/lib/limits";
import { LG_COLS, SM_COLS } from "@/lib/tile-specs";
import { isPreviewKey, isShareImageKey, objectKeyFromUrl, objectUrl } from "@/lib/storage-keys";
import {
  PLATFORMS,
  type AuthorProfile,
  type Board,
  type BoardItem,
  type BoardWith,
  type GridLayouts,
  type JsonItem,
  type LockedPlaintext,
  type NoteItem,
  type OGData,
  type Platform,
  type Page,
  type ShareRequest,
  type ShareRequestImageItem,
  type ShareRequestItem,
  type SharedImageItem,
  type TextItem,
  type UrlItem,
} from "@/lib/types";

type PageLimits = { maxPages: number; maxItemsPerPage: number };

const BOARD_PAGE_LIMITS: PageLimits = {
  maxPages: LIMITS.maxPages,
  maxItemsPerPage: LIMITS.maxItemsPerPage,
};

function keepHttpUrl(value: unknown, max: number): string | null {
  const trimmed = readTrimmed(value, max);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function readId(value: unknown): string {
  return readTrimmed(value, LIMITS.maxIdChars);
}

function readPlatform(value: unknown): Platform | null {
  return PLATFORMS.find((platform) => platform === value) ?? null;
}

export function sanitizeOgData(value: unknown): OGData | undefined {
  if (!isRecord(value)) return undefined;
  const og: OGData = {};
  const title = readTrimmed(value.title, LIMITS.maxOgTextChars);
  const description = readTrimmed(value.description, LIMITS.maxOgTextChars);
  const image = keepHttpUrl(value.image, LIMITS.maxLinkChars);
  const siteName = readTrimmed(value.siteName, LIMITS.maxLabelChars);
  const author = readTrimmed(value.author, LIMITS.maxLabelChars);
  if (title) og.title = title;
  if (description) og.description = description;
  if (image) og.image = image;
  if (siteName) og.siteName = siteName;
  if (author) og.author = author;
  return Object.keys(og).length > 0 ? og : undefined;
}

function sanitizeLayoutList(input: unknown, cols: number, ids: ReadonlySet<string>): GridLayouts["lg"] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: GridLayouts["lg"] = [];
  for (const entry of input) {
    if (!isRecord(entry)) continue;
    const i = readId(entry.i);
    const [x, y, w, h] = [entry.x, entry.y, entry.w, entry.h].map(Number);
    if (!i || !ids.has(i) || seen.has(i)) continue;
    if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
    if (![x, y, w, h].every(Number.isFinite)) continue;
    seen.add(i);
    const width = Math.min(Math.max(1, Math.floor(w)), cols);
    out.push({
      i,
      x: Math.max(0, Math.min(Math.floor(x), cols - width)),
      y: Math.max(0, Math.floor(y)),
      w: width,
      h: Math.max(1, Math.floor(h)),
    });
  }
  return out;
}

export function sanitizeLayouts(value: unknown, items: readonly { id: string }[]): GridLayouts {
  if (!isRecord(value)) return { lg: [], sm: [] };
  const ids = new Set(items.map((item) => item.id));
  return { lg: sanitizeLayoutList(value.lg, LG_COLS, ids), sm: sanitizeLayoutList(value.sm, SM_COLS, ids) };
}

export function layoutsAsJson(layouts: GridLayouts) {
  const wire = (list: GridLayouts["lg"]) => list.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
  return { lg: wire(layouts.lg), sm: wire(layouts.sm) };
}

export function sanitizeAuthorProfile(value: unknown): AuthorProfile | undefined {
  if (!isRecord(value)) return undefined;
  const profile: AuthorProfile = {};
  const xUrl = keepHttpUrl(value.xUrl, LIMITS.maxLinkChars);
  const instagramUrl = keepHttpUrl(value.instagramUrl, LIMITS.maxLinkChars);
  const linkedinUrl = keepHttpUrl(value.linkedinUrl, LIMITS.maxLinkChars);
  if (xUrl) profile.xUrl = xUrl;
  if (instagramUrl) profile.instagramUrl = instagramUrl;
  if (linkedinUrl) profile.linkedinUrl = linkedinUrl;
  return Object.keys(profile).length > 0 ? profile : undefined;
}

const SOCIAL_HOSTS = {
  xUrl: ["x.com", "twitter.com"],
  instagramUrl: ["instagram.com"],
  linkedinUrl: ["linkedin.com"],
} as const;

function sanitizeSocialProfile(value: unknown): AuthorProfile | undefined {
  const profile = sanitizeAuthorProfile(value);
  if (!profile) return undefined;
  const strict: AuthorProfile = {};
  for (const field of ["xUrl", "instagramUrl", "linkedinUrl"] as const) {
    const url = profile[field];
    if (!url) continue;
    const host = new URL(url).hostname.toLowerCase();
    if (SOCIAL_HOSTS[field].some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) strict[field] = url;
  }
  return Object.keys(strict).length > 0 ? strict : undefined;
}

function sanitizeUrlItem(value: JsonRecord): UrlItem | null {
  const id = readId(value.id);
  const url = keepHttpUrl(value.url, LIMITS.maxUrlChars);
  const platform = readPlatform(value.platform);
  if (!id || !url || !platform) return null;
  const item: UrlItem = { id, type: "url", url, platform };
  const ogData = sanitizeOgData(value.ogData);
  if (ogData) item.ogData = ogData;
  return item;
}

function sanitizeNoteItem(value: JsonRecord): NoteItem | null {
  const id = readId(value.id);
  const html = readTrimmed(value.html, LIMITS.maxNoteChars);
  return id && html ? { id, type: "note", html } : null;
}

function sanitizeJsonItem(value: JsonRecord): JsonItem | null {
  const id = readId(value.id);
  const name = readTrimmed(value.name, LIMITS.maxLabelChars) || "data.json";
  const text = readString(value.text)?.trim() ?? "";
  if (!id || !text || text.length > LIMITS.maxJsonFileBytes) return null;
  const size = readPositiveInt(value.size) ?? new TextEncoder().encode(text).byteLength;
  if (size > LIMITS.maxJsonFileBytes) return null;
  return { id, type: "json", name, text, size };
}

export function readImageFields(value: JsonRecord): ShareRequestImageItem | null {
  const id = readId(value.id);
  if (!id) return null;
  const item: ShareRequestImageItem = { id, type: "image" };
  const mimeType = readTrimmed(value.mimeType, LIMITS.maxLabelChars);
  const size = readPositiveInt(value.size);
  const caption = readTrimmed(value.caption, LIMITS.maxCaptionChars);
  if (mimeType) item.mimeType = mimeType;
  if (size !== undefined) item.size = size;
  if (caption) item.caption = caption;
  return item;
}

function sanitizeSharedImageItem(value: JsonRecord): SharedImageItem | null {
  const fields = readImageFields(value);
  const fromField = readTrimmed(value.objectKey, 240);
  const objectKey = isShareImageKey(fromField) ? fromField : objectKeyFromUrl(readTrimmed(value.url, LIMITS.maxUrlChars));
  if (!fields || !objectKey || !isShareImageKey(objectKey)) return null;
  return { ...fields, objectKey, url: objectUrl(objectKey) };
}

function sanitizeTextItem(value: unknown): TextItem | null {
  if (!isRecord(value)) return null;
  if (value.type === "url") return sanitizeUrlItem(value);
  if (value.type === "note") return sanitizeNoteItem(value);
  if (value.type === "json") return sanitizeJsonItem(value);
  return null;
}

function sanitizeShareRequestItem(value: unknown): ShareRequestItem | null {
  if (isRecord(value) && value.type === "image") return readImageFields(value);
  return sanitizeTextItem(value);
}

export function sanitizeStoredItem(value: unknown): BoardItem | null {
  if (isRecord(value) && value.type === "image") return sanitizeSharedImageItem(value);
  return sanitizeTextItem(value);
}

function sanitizePages<T extends { id: string }>(
  value: unknown,
  sanitizeItem: (item: unknown) => T | null,
  limits?: PageLimits,
): Page<T>[] {
  if (!Array.isArray(value)) return [];
  const pageIds = new Set<string>();
  const itemIds = new Set<string>();
  const pages: Page<T>[] = [];
  for (const entry of limits ? value.slice(0, limits.maxPages) : value) {
    if (!isRecord(entry)) continue;
    const id = readId(entry.id);
    if (!id) continue;
    if (pageIds.has(id)) return [];
    pageIds.add(id);
    const rawItems = Array.isArray(entry.items) ? entry.items : [];
    const items: T[] = [];
    for (const raw of limits ? rawItems.slice(0, limits.maxItemsPerPage) : rawItems) {
      const item = sanitizeItem(raw);
      if (!item) continue;
      if (itemIds.has(item.id)) return [];
      itemIds.add(item.id);
      items.push(item);
    }
    pages.push({ id, items, layouts: sanitizeLayouts(entry.layouts, items) });
  }
  return pages;
}

function boardEnvelope<T>(value: JsonRecord, pages: Page<T>[], fallbackId: string): BoardWith<T> {
  const board: BoardWith<T> = {
    id: readId(value.id) || fallbackId,
    author: readTrimmed(value.author, LIMITS.maxAuthorChars) || "Anonymous",
    pages,
    createdAt: readTrimmed(value.createdAt, 40) || new Date().toISOString(),
  };
  const authorProfile = sanitizeSocialProfile(value.authorProfile);
  if (authorProfile) board.authorProfile = authorProfile;
  return board;
}

function hasItems(pages: readonly { items: readonly unknown[] }[]) {
  return pages.some((page) => page.items.length > 0);
}

export function sanitizeShareRequest(value: unknown): ShareRequest | null {
  if (!isRecord(value)) return null;
  const pages = sanitizePages(value.pages, sanitizeShareRequestItem);
  if (pages.length === 0) return null;
  const request: ShareRequest = { pages };
  const author = readString(value.author);
  if (author !== null) request.author = author;
  const authorProfile = sanitizeSocialProfile(value.authorProfile);
  if (authorProfile) request.authorProfile = authorProfile;
  return request;
}

export function sanitizeTextBoard(value: unknown): Board | null {
  if (!isRecord(value)) return null;
  const pages = sanitizePages(value.pages, sanitizeTextItem, BOARD_PAGE_LIMITS);
  return hasItems(pages) ? boardEnvelope(value, pages, "tiny") : null;
}

export function sanitizeStoredBoard(value: unknown): Board | null {
  if (!isRecord(value)) return null;
  const pages = sanitizePages(value.pages, sanitizeStoredItem);
  if (!hasItems(pages)) return null;
  const board = boardEnvelope(value, pages, "shared");
  const previewKey = objectKeyFromUrl(readTrimmed(value.previewUrl, LIMITS.maxLinkChars));
  if (previewKey && isPreviewKey(previewKey)) board.previewUrl = objectUrl(previewKey);
  return board;
}

export function sanitizeLockedPlaintext(value: unknown): LockedPlaintext | null {
  if (!isRecord(value)) return null;
  const pages = sanitizePages(value.pages, sanitizeShareRequestItem, BOARD_PAGE_LIMITS);
  return hasItems(pages) ? boardEnvelope(value, pages, "locked") : null;
}

function itemAsJson(item: BoardItem): JsonRecord | null {
  if (item.type === "url") {
    const json: JsonRecord = { id: item.id, type: "url", url: item.url, platform: item.platform };
    if (item.ogData) json.ogData = { ...item.ogData };
    return json;
  }
  if (item.type === "note") return { id: item.id, type: "note", html: item.html };
  if (item.type === "json") return { id: item.id, type: "json", name: item.name, text: item.text, size: item.size };
  if (!("objectKey" in item)) return null;
  const json: JsonRecord = { id: item.id, type: "image", url: item.url, objectKey: item.objectKey };
  if (item.mimeType) json.mimeType = item.mimeType;
  if (item.size !== undefined) json.size = item.size;
  if (item.caption) json.caption = item.caption;
  return json;
}

function boardJson<T>(board: BoardWith<T>, item: (value: T) => unknown): JsonRecord {
  const json: JsonRecord = {
    id: board.id,
    author: board.author,
    createdAt: board.createdAt,
    pages: board.pages.map((page) => ({
      id: page.id,
      layouts: layoutsAsJson(page.layouts),
      items: page.items.map(item).filter((value) => value !== null),
    })),
  };
  if (board.authorProfile) json.authorProfile = { ...board.authorProfile };
  if (board.previewUrl) json.previewUrl = board.previewUrl;
  return json;
}

export function boardAsJson(board: Board): JsonRecord {
  return boardJson(board, itemAsJson);
}

export function lockedPlaintextAsJson(plaintext: LockedPlaintext): JsonRecord {
  return boardJson(plaintext, (item) => item);
}
