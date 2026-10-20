import type { LayoutItem } from "react-grid-layout";

export const PLATFORMS = [
  "twitter",
  "linkedin",
  "instagram",
  "youtube",
  "reddit",
  "threads",
  "facebook",
  "tiktok",
  "website",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface OGData {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  author?: string;
}

export interface UrlItem {
  id: string;
  type: "url";
  url: string;
  platform: Platform;
  ogData?: OGData;
}

export interface NoteItem {
  id: string;
  type: "note";
  html: string;
}

export interface JsonItem {
  id: string;
  type: "json";
  name: string;
  text: string;
  size: number;
}

interface ImageFields {
  id: string;
  type: "image";
  mimeType?: string;
  size?: number;
  caption?: string;
}

export interface DraftImageItem extends ImageFields {
  file: File;
  previewUrl: string;
  aspect?: number;
}

export interface SharedImageItem extends ImageFields {
  objectKey: string;
  url: string;
}

export type ImageItem = DraftImageItem | SharedImageItem;
export type TextItem = UrlItem | NoteItem | JsonItem;
export type BoardItem = TextItem | ImageItem;

export type ShareRequestImageItem = ImageFields;
export type ShareRequestItem = TextItem | ShareRequestImageItem;

export interface GridLayouts {
  lg: LayoutItem[];
  sm: LayoutItem[];
}

export interface AuthorProfile {
  xUrl?: string;
  instagramUrl?: string;
  linkedinUrl?: string;
}

export interface Page<T> {
  id: string;
  items: T[];
  layouts: GridLayouts;
}

export type BoardPage = Page<BoardItem>;

export interface BoardWith<T> {
  id: string;
  author: string;
  authorProfile?: AuthorProfile;
  pages: Page<T>[];
  createdAt: string;
  previewUrl?: string;
}

export type Board = BoardWith<BoardItem>;
export type LockedPlaintext = BoardWith<ShareRequestItem>;

export interface ShareRequest {
  author?: string;
  authorProfile?: AuthorProfile;
  pages: Page<ShareRequestItem>[];
}

export type StoredShareKind = "stored" | "locked";

export type BoardOrigin =
  | { kind: "draft" }
  | { kind: StoredShareKind; id: string };

export type SelectionEvent = { metaKey?: boolean; ctrlKey?: boolean };

export interface ShareCreateResponse {
  id: string;
}

export interface EncryptedShareImage {
  id: string;
  pageId: string;
  key: string;
  url: string;
  iv: string;
  size: number;
}

export interface PinVerifier {
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  hash: string;
}

export interface EncryptedBoardEnvelope {
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
}

export interface LockedBoardStub {
  id: string;
  encrypted: true;
  locked: true;
}

export type BoardFetchResponse = Board | LockedBoardStub;

export function isLockedBoardStub(value: BoardFetchResponse): value is LockedBoardStub {
  return "locked" in value;
}

export function isDraftImageItem(item: BoardItem): item is DraftImageItem {
  return item.type === "image" && "file" in item;
}

export function isSharedImageItem(item: BoardItem): item is SharedImageItem {
  return item.type === "image" && "objectKey" in item;
}

export function imageSource(item: ImageItem): string {
  return "file" in item ? item.previewUrl : item.url;
}

export function imageAspectKey(item: ImageItem): string {
  return "file" in item ? `image:${item.id}` : `image:${item.url}`;
}

export function emptyLayouts(): GridLayouts {
  return { lg: [], sm: [] };
}
