import type { LayoutItem } from "react-grid-layout";

export type Platform =
  | "twitter"
  | "linkedin"
  | "instagram"
  | "youtube"
  | "reddit"
  | "threads"
  | "facebook"
  | "tiktok"
  | "website";

export interface UrlItem {
  id: string;
  type: "url";
  url: string;
  platform: Platform;
  ogData?: OGData;
}

export interface DraftImageItem {
  id: string;
  type: "image";
  /** Browser-only preview. Must not enter tiny shares, stored manifests, or locked envelopes. */
  previewUrl: string;
  /** Browser-only file handle. The share pipeline uploads bytes separately. */
  file: File;
  url?: never;
  objectKey?: never;
  mimeType?: string;
  size?: number;
  caption?: string;
  aspect?: number;
}

export interface SharedImageItem {
  id: string;
  type: "image";
  /** Public R2 URL, or a temporary blob URL after client-side locked-share decrypt. */
  url: string;
  /** Canonical R2 object key used for deletion, independent of the public URL shape. */
  objectKey?: string;
  previewUrl?: never;
  file?: never;
  mimeType?: string;
  size?: number;
  caption?: string;
}

export interface NoteItem {
  id: string;
  type: "note";
  text: string;
}

/** Synthetic item for AI overall summary — same grid behavior as other cards; data lives on `generation`. */
export const BOARD_SUMMARY_ITEM_ID = "__summary__" as const;

export interface BoardSummaryItem {
  id: typeof BOARD_SUMMARY_ITEM_ID;
  type: "board_summary";
}

export type EditorCanvasItem =
  | UrlItem
  | DraftImageItem
  | SharedImageItem
  | NoteItem
  | BoardSummaryItem;
export type CanvasItem = EditorCanvasItem;

export type ShareableCanvasItem =
  | UrlItem
  | SharedImageItem
  | NoteItem
  | BoardSummaryItem;
export type SharedCanvasItem = ShareableCanvasItem;

export type ShareRequestImageItem = Pick<
  SharedImageItem,
  "id" | "type" | "mimeType" | "size" | "caption"
>;
export type ShareRequestItem = UrlItem | NoteItem | ShareRequestImageItem;

export interface OGData {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  author?: string;
}

export interface ItemSummary {
  item_id: string;
  title: string;
  summary: string;
  source_type?: string;
  author?: string;
  key_quote?: string;
}

export interface OverallSummary {
  title: string;
  explanation: string;
  tags: string[];
}

export interface GenerateResponse {
  item_summaries: ItemSummary[];
  overall_summary: OverallSummary;
}

export interface GridLayouts {
  lg: LayoutItem[];
  sm: LayoutItem[];
}

/** Optional profile links for shared boards (stored with canvas JSON). */
export interface AuthorProfile {
  xUrl?: string;
  instagramUrl?: string;
  linkedinUrl?: string;
}

export interface EditorBoardPage {
  id: string;
  items: EditorCanvasItem[];
  layouts: GridLayouts;
}
export type BoardPage = EditorBoardPage;

export interface ShareableBoardPage {
  id: string;
  items: ShareableCanvasItem[];
  layouts?: GridLayouts;
}
export type SharedBoardPage = ShareableBoardPage;

export interface PublicCanvasManifest {
  id: string;
  author: string;
  authorProfile?: AuthorProfile;
  pages: ShareableBoardPage[];
  generation?: GenerateResponse;
  createdAt: string;
  deleteTokenHash?: string;
}
export type Canvas = PublicCanvasManifest;

export interface ShareRequestPayload {
  author?: unknown;
  authorProfile?: unknown;
  generation?: unknown;
  pages: Array<{
    id: string;
    layouts?: GridLayouts;
    items: ShareRequestItem[];
  }>;
}

export interface ShareCreateResponse {
  id: string;
  deleteToken: string;
}

export interface EncryptedShareImage {
  id: string;
  pageId: string;
  key: string;
  url: string;
  iv: string;
  size: number;
}

export interface EncryptedCanvasEnvelope {
  id: string;
  encrypted: true;
  v: 1;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  iv: string;
  data: string;
  images: EncryptedShareImage[];
  createdAt: string;
  pinVerifier?: {
    kdf: "PBKDF2-SHA-256";
    iterations: number;
    salt: string;
    hash: string;
  };
  deleteTokenHash?: string;
}

/** Wire shape returned by GET /api/share when the board is encrypted but the
 * client hasn't unlocked it yet. Never persisted — see `StoredCanvas`. */
export interface LockedCanvasStub {
  id: string;
  encrypted: true;
  locked: true;
}

/** What the server actually persists in R2. */
export type StoredCanvas = Canvas | EncryptedCanvasEnvelope;

/** What `/api/share?key=canvases/<id>.json` can return: the stored manifest
 * (public boards), or the locked stub (encrypted boards before unlock). */
export type CanvasFetchResponse = Canvas | LockedCanvasStub;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function isEncryptedCanvas(value: unknown): value is EncryptedCanvasEnvelope {
  return (
    isRecord(value) &&
    value.encrypted === true &&
    value.v === 1 &&
    value.kdf === "PBKDF2-SHA-256" &&
    typeof value.id === "string" &&
    typeof value.data === "string" &&
    typeof value.iv === "string" &&
    typeof value.salt === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.iterations === "number" &&
    Array.isArray(value.images) &&
    value.images.every(
      (image) =>
        isRecord(image) &&
        typeof image.id === "string" &&
        typeof image.pageId === "string" &&
        typeof image.key === "string" &&
        typeof image.url === "string" &&
        typeof image.iv === "string" &&
        typeof image.size === "number",
    )
  );
}

export function isLockedCanvasStub(value: unknown): value is LockedCanvasStub {
  return isRecord(value) && value.encrypted === true && value.locked === true && typeof value.id === "string";
}

export function isDraftImageItem(item: CanvasItem): item is DraftImageItem {
  return item.type === "image" && "file" in item;
}

export function isShareCreateResponse(value: unknown): value is ShareCreateResponse {
  return isRecord(value) && typeof value.id === "string" && typeof value.deleteToken === "string";
}

export type GenerateRequestImageItem = Pick<SharedImageItem, "id" | "type" | "caption">;
export type GenerateRequestItem = UrlItem | NoteItem | GenerateRequestImageItem;

export interface GenerateRequestPayload {
  items: GenerateRequestItem[];
}
