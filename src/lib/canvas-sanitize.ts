import {
  getLocalShareObjectKey,
  isShareImageObjectKey,
  keepObjectKey,
} from "@/lib/storage-keys";
import type {
  AuthorProfile,
  Canvas,
  GridLayouts,
  JsonItem,
  OGData,
  Platform,
  ShareRequestImageItem,
  ShareRequestItem,
  ShareRequestPayload,
  SharedImageItem,
  ShareableCanvasItem,
} from "@/lib/types";

export const PLATFORMS = new Set<Platform>([
  "twitter",
  "linkedin",
  "instagram",
  "youtube",
  "reddit",
  "threads",
  "facebook",
  "tiktok",
  "website",
]);

export const SANITIZE_LIMITS = {
  maxAuthorChars: 80,
  maxNoteChars: 20000,
  maxUrlChars: 4096,
  maxOgTextChars: 300,
  maxOgImageChars: 2048,
  maxSocialUrlChars: 2048,
  maxJsonNameChars: 120,
  maxJsonChars: 256 * 1024,
} as const;

export function trimText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function keepHttpUrl(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function keepStoredImageUrl(value: unknown, max: number): string | null {
  const httpUrl = keepHttpUrl(value, max);
  if (httpUrl) return httpUrl;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  const key = getLocalShareObjectKey(trimmed);
  return key && isShareImageObjectKey(key) ? trimmed : null;
}

function keepStoredPreviewUrl(value: unknown, max: number): string | null {
  const httpUrl = keepHttpUrl(value, max);
  if (httpUrl) return httpUrl;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  const key = getLocalShareObjectKey(trimmed);
  return key && key.startsWith("previews/") ? trimmed : null;
}

export function sanitizeOgData(value: unknown): OGData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const og = value as Record<string, unknown>;
  const title = trimText(og.title, SANITIZE_LIMITS.maxOgTextChars);
  const description = trimText(og.description, SANITIZE_LIMITS.maxOgTextChars);
  const image = keepHttpUrl(og.image, SANITIZE_LIMITS.maxOgImageChars);
  const siteName = trimText(og.siteName, 120);
  const author = trimText(og.author, 120);

  if (!title && !description && !image && !siteName && !author) return undefined;
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(siteName ? { siteName } : {}),
    ...(author ? { author } : {}),
  };
}

export function sanitizeLayouts(value: unknown): GridLayouts | undefined {
  if (!value || typeof value !== "object") return undefined;

  const sanitizeList = (input: unknown) =>
    Array.isArray(input)
      ? input
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const item = entry as Record<string, unknown>;
            const i = trimText(item.i, 80);
            const x = Number(item.x);
            const y = Number(item.y);
            const w = Number(item.w);
            const h = Number(item.h);
            if (!i || ![x, y, w, h].every(Number.isFinite)) return null;
            return {
              i,
              x: Math.max(0, Math.floor(x)),
              y: Math.max(0, Math.floor(y)),
              w: Math.max(1, Math.floor(w)),
              h: Math.max(1, Math.floor(h)),
            };
          })
          .filter((entry): entry is NonNullable<typeof entry> => !!entry)
      : [];

  const layouts = value as Record<string, unknown>;
  const lg = sanitizeList(layouts.lg);
  const sm = sanitizeList(layouts.sm);
  if (lg.length === 0 && sm.length === 0) return undefined;
  return { lg, sm };
}

export function sanitizeAuthorProfile(value: unknown): AuthorProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const profile: AuthorProfile = {};
  const xUrl = keepHttpUrl(input.xUrl, SANITIZE_LIMITS.maxSocialUrlChars);
  const instagramUrl = keepHttpUrl(input.instagramUrl, SANITIZE_LIMITS.maxSocialUrlChars);
  const linkedinUrl = keepHttpUrl(input.linkedinUrl, SANITIZE_LIMITS.maxSocialUrlChars);
  if (xUrl) profile.xUrl = xUrl;
  if (instagramUrl) profile.instagramUrl = instagramUrl;
  if (linkedinUrl) profile.linkedinUrl = linkedinUrl;
  return Object.keys(profile).length ? profile : undefined;
}

export function sanitizeUrlItem(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = trimText(item.id, 80);
  const url = keepHttpUrl(item.url, SANITIZE_LIMITS.maxUrlChars);
  const platform = trimText(item.platform, 40);
  if (!id || !url || !PLATFORMS.has(platform as Platform)) return null;
  const ogData = sanitizeOgData(item.ogData);
  return {
    id,
    type: "url" as const,
    url,
    platform: platform as Platform,
    ...(ogData ? { ogData } : {}),
  };
}

// SECURITY: `text` is untrusted tiptap-authored HTML. This only length-bounds
// it — it is NOT HTML-sanitized here. Every render path must feed it back
// through tiptap/ProseMirror (which drops disallowed nodes/attrs on parse); do
// NOT render note text via innerHTML/dangerouslySetInnerHTML, or it becomes
// stored XSS on shared boards.
export function sanitizeNoteItem(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = trimText(item.id, 80);
  const text = trimText(item.text, SANITIZE_LIMITS.maxNoteChars);
  return id && text ? { id, type: "note" as const, text } : null;
}

export function sanitizeJsonItem(value: unknown): JsonItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = trimText(item.id, 80);
  const name = trimText(item.name, SANITIZE_LIMITS.maxJsonNameChars) || "data.json";
  const text = typeof item.text === "string" ? item.text.trim() : "";
  const size = Number(item.size);
  if (!id || !text || text.length > SANITIZE_LIMITS.maxJsonChars) return null;
  const safeSize = Number.isFinite(size) && size > 0 ? Math.floor(size) : new TextEncoder().encode(text).byteLength;
  if (safeSize > SANITIZE_LIMITS.maxJsonChars) return null;
  return { id, type: "json", name, text, size: safeSize };
}

export function sanitizeShareRequestImageItem(value: unknown): ShareRequestImageItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = trimText(item.id, 80);
  const mimeType = trimText(item.mimeType, 120) || undefined;
  const size = Number(item.size);
  const caption = trimText(item.caption, 300) || undefined;
  if (!id) return null;
  return {
    id,
    type: "image",
    ...(mimeType ? { mimeType } : {}),
    ...(Number.isFinite(size) && size > 0 ? { size: Math.floor(size) } : {}),
    ...(caption ? { caption } : {}),
  };
}

export function sanitizeShareRequestItem(value: unknown): ShareRequestItem | null {
  if (!value || typeof value !== "object") return null;
  const type = trimText((value as Record<string, unknown>).type, 20);
  if (type === "url") return sanitizeUrlItem(value);
  if (type === "note") return sanitizeNoteItem(value);
  if (type === "json") return sanitizeJsonItem(value);
  if (type === "image") return sanitizeShareRequestImageItem(value);
  return null;
}

export function sanitizeSharedImageItem(
  value: unknown,
  options: { allowBlobUrl?: boolean } = {},
): SharedImageItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = trimText(item.id, 80);
  const storedUrl = keepStoredImageUrl(item.url, SANITIZE_LIMITS.maxUrlChars);
  const blobUrl =
    options.allowBlobUrl && typeof item.url === "string" && item.url.startsWith("blob:")
      ? item.url
      : null;
  const url = storedUrl ?? blobUrl;
  const objectKey = keepObjectKey(item.objectKey) || undefined;
  const mimeType = trimText(item.mimeType, 120) || undefined;
  const size = Number(item.size);
  const caption = trimText(item.caption, 300) || undefined;
  if (!id || !url) return null;
  return {
    id,
    type: "image",
    url,
    ...(objectKey ? { objectKey } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(Number.isFinite(size) && size > 0 ? { size: Math.floor(size) } : {}),
    ...(caption ? { caption } : {}),
  };
}

export function sanitizeShareableCanvasItem(
  value: unknown,
  options: { allowBlobImageUrls?: boolean } = {},
): ShareableCanvasItem | null {
  if (!value || typeof value !== "object") return null;
  const type = trimText((value as Record<string, unknown>).type, 20);
  if (type === "url") return sanitizeUrlItem(value);
  if (type === "note") return sanitizeNoteItem(value);
  if (type === "json") return sanitizeJsonItem(value);
  if (type === "image") return sanitizeSharedImageItem(value, { allowBlobUrl: options.allowBlobImageUrls });
  return null;
}

function sanitizePageLayouts(value: unknown, items: readonly { id: string }[]): GridLayouts | undefined {
  const layouts = sanitizeLayouts(value);
  if (!layouts) return undefined;
  const ids = new Set(items.map((item) => item.id));
  const lg = layouts.lg.filter((layout) => ids.has(layout.i));
  const sm = layouts.sm.filter((layout) => ids.has(layout.i));
  return lg.length || sm.length ? { lg, sm } : undefined;
}

/**
 * Shared pages→items traversal for the three canvas sanitizers, which differ
 * only in item policy and caps: pages need an id, items pass through
 * `sanitizeItem`, layouts are pruned to surviving items, dead pages drop.
 */
function sanitizePages<T extends { id: string }>(
  value: unknown,
  sanitizeItem: (item: unknown) => T | null,
  limits?: { maxPages: number; maxItemsPerPage: number },
): { id: string; items: T[]; layouts?: GridLayouts }[] {
  if (!Array.isArray(value)) return [];
  const rawPages = limits ? value.slice(0, limits.maxPages) : value;
  return rawPages
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const page = entry as Record<string, unknown>;
      const id = trimText(page.id, 80);
      if (!id) return null;
      const rawItems = Array.isArray(page.items)
        ? limits
          ? page.items.slice(0, limits.maxItemsPerPage)
          : page.items
        : [];
      const items = rawItems.map(sanitizeItem).filter((item): item is T => !!item);
      return { id, items, layouts: sanitizePageLayouts(page.layouts, items) };
    })
    .filter((page): page is NonNullable<typeof page> => !!page);
}

function sanitizeCanvasEnvelope(
  canvas: Record<string, unknown>,
  pages: Canvas["pages"],
  fallbackId: string,
): Canvas {
  const authorProfile = sanitizeAuthorProfile(canvas.authorProfile);
  return {
    id: trimText(canvas.id, 80) || fallbackId,
    author: trimText(canvas.author, SANITIZE_LIMITS.maxAuthorChars) || "Anonymous",
    ...(authorProfile ? { authorProfile } : {}),
    pages,
    createdAt: trimText(canvas.createdAt, 40) || new Date().toISOString(),
  };
}

export function sanitizeShareRequestPayload(value: unknown): ShareRequestPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const pages = sanitizePages(payload.pages, sanitizeShareRequestItem);
  if (pages.length === 0) return null;
  return {
    author: payload.author,
    authorProfile: payload.authorProfile,
    pages,
  };
}

export function sanitizeTinyCanvas(value: unknown, limits = { maxPages: 12, maxItemsPerPage: 60 }): Canvas | null {
  if (!value || typeof value !== "object") return null;
  const canvas = value as Record<string, unknown>;
  const pages = sanitizePages(
    canvas.pages,
    (item): ShareableCanvasItem | null => {
      const sanitized = sanitizeShareRequestItem(item);
      return sanitized && sanitized.type !== "image" ? sanitized : null;
    },
    limits,
  );
  if (!pages.some((page) => page.items.length > 0)) return null;
  return sanitizeCanvasEnvelope(canvas, pages, "tiny");
}

export function sanitizePublicCanvasManifest(
  value: unknown,
  options: { allowBlobImageUrls?: boolean } = {},
): Canvas | null {
  if (!value || typeof value !== "object") return null;
  const canvas = value as Record<string, unknown>;
  const pages = sanitizePages(canvas.pages, (item) => sanitizeShareableCanvasItem(item, options));
  if (!pages.some((page) => page.items.length > 0)) return null;
  const previewUrl = keepStoredPreviewUrl(canvas.previewUrl, SANITIZE_LIMITS.maxOgImageChars);
  return {
    ...sanitizeCanvasEnvelope(canvas, pages, "shared"),
    ...(typeof canvas.deleteTokenHash === "string" ? { deleteTokenHash: canvas.deleteTokenHash } : {}),
    ...(previewUrl ? { previewUrl } : {}),
  };
}
