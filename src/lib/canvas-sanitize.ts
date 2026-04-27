import { BOARD_SUMMARY_ITEM_ID } from "@/lib/types";
import {
  getLocalShareObjectKey,
  isShareImageObjectKey,
  keepObjectKey,
} from "@/lib/storage-keys";
import type {
  AuthorProfile,
  Canvas,
  GenerateResponse,
  GenerateRequestItem,
  GenerateRequestPayload,
  GridLayouts,
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
  maxSummaryChars: 12000,
  maxSummaryItemChars: 800,
  maxTags: 8,
  maxSocialUrlChars: 2048,
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

export function sanitizeGeneration(value: unknown): GenerateResponse | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const itemSummaries = Array.isArray(input.item_summaries)
    ? input.item_summaries
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as Record<string, unknown>;
          const item_id = trimText(item.item_id, 80);
          const title = trimText(item.title, 160);
          const summary = trimText(item.summary, SANITIZE_LIMITS.maxSummaryItemChars);
          const source_type = trimText(item.source_type, 80);
          const author = trimText(item.author, 160);
          const key_quote = trimText(item.key_quote, 300);
          if (!item_id || !title || !summary) return null;
          return {
            item_id,
            title,
            summary,
            ...(source_type ? { source_type } : {}),
            ...(author ? { author } : {}),
            ...(key_quote ? { key_quote } : {}),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    : [];

  const overall = input.overall_summary;
  if (!overall || typeof overall !== "object") {
    return itemSummaries.length > 0
      ? {
          item_summaries: itemSummaries,
          overall_summary: { title: "Shareboard", explanation: "", tags: [] },
        }
      : undefined;
  }

  const summary = overall as Record<string, unknown>;
  return {
    item_summaries: itemSummaries,
    overall_summary: {
      title: trimText(summary.title, 160) || "Shareboard",
      explanation: trimText(summary.explanation, SANITIZE_LIMITS.maxSummaryChars),
      tags: Array.isArray(summary.tags)
        ? summary.tags
            .map((tag) => trimText(tag, 40))
            .filter(Boolean)
            .slice(0, SANITIZE_LIMITS.maxTags)
        : [],
    },
  };
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

export function sanitizeNoteItem(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = trimText(item.id, 80);
  const text = trimText(item.text, SANITIZE_LIMITS.maxNoteChars);
  return id && text ? { id, type: "note" as const, text } : null;
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
  options: { allowBlobImageUrls?: boolean; allowBoardSummary?: boolean } = {},
): ShareableCanvasItem | null {
  if (!value || typeof value !== "object") return null;
  const type = trimText((value as Record<string, unknown>).type, 20);
  if (type === "url") return sanitizeUrlItem(value);
  if (type === "note") return sanitizeNoteItem(value);
  if (type === "image") return sanitizeSharedImageItem(value, { allowBlobUrl: options.allowBlobImageUrls });
  if (
    options.allowBoardSummary &&
    type === "board_summary" &&
    trimText((value as Record<string, unknown>).id, 80) === BOARD_SUMMARY_ITEM_ID
  ) {
    return { id: BOARD_SUMMARY_ITEM_ID, type: "board_summary" };
  }
  return null;
}

export function sanitizeShareRequestPayload(value: unknown): ShareRequestPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  const pages = Array.isArray(payload.pages)
    ? payload.pages.map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const page = entry as Record<string, unknown>;
        const id = trimText(page.id, 80);
        if (!id) return null;
        return {
          id,
          layouts: sanitizeLayouts(page.layouts),
          items: Array.isArray(page.items)
            ? page.items.map(sanitizeShareRequestItem).filter((item): item is ShareRequestItem => !!item)
            : [],
        };
      })
    : [];

  const cleanPages = pages.filter((page): page is NonNullable<typeof page> => !!page);
  if (cleanPages.length === 0) return null;
  return {
    author: payload.author,
    authorProfile: payload.authorProfile,
    generation: payload.generation,
    pages: cleanPages,
  };
}

export function sanitizeTinyCanvas(value: unknown, limits = { maxPages: 12, maxItemsPerPage: 60 }): Canvas | null {
  if (!value || typeof value !== "object") return null;
  const canvas = value as Record<string, unknown>;
  const pages = Array.isArray(canvas.pages)
    ? canvas.pages
        .slice(0, limits.maxPages)
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const page = entry as Record<string, unknown>;
          const id = trimText(page.id, 80);
          const items = Array.isArray(page.items)
            ? page.items
                .slice(0, limits.maxItemsPerPage)
                .map((item): ShareableCanvasItem | null => {
                  const sanitized = sanitizeShareRequestItem(item);
                  return sanitized && sanitized.type !== "image" ? sanitized : null;
                })
                .filter((item): item is ShareableCanvasItem => !!item)
            : [];
          return id ? { id, items, layouts: sanitizeLayouts(page.layouts) } : null;
        })
        .filter((page): page is NonNullable<typeof page> => !!page)
    : [];

  if (!pages.some((page) => page.items.length > 0)) return null;
  const authorProfile = sanitizeAuthorProfile(canvas.authorProfile);
  const generation = sanitizeGeneration(canvas.generation);
  return {
    id: trimText(canvas.id, 80) || "tiny",
    author: trimText(canvas.author, SANITIZE_LIMITS.maxAuthorChars) || "Anonymous",
    ...(authorProfile ? { authorProfile } : {}),
    pages,
    ...(generation ? { generation } : {}),
    createdAt: trimText(canvas.createdAt, 40) || new Date().toISOString(),
  };
}

export function sanitizePublicCanvasManifest(
  value: unknown,
  options: { allowBlobImageUrls?: boolean; allowBoardSummary?: boolean } = {},
): Canvas | null {
  if (!value || typeof value !== "object") return null;
  const canvas = value as Record<string, unknown>;
  const pages = Array.isArray(canvas.pages)
    ? canvas.pages.map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const page = entry as Record<string, unknown>;
        const id = trimText(page.id, 80);
        const items = Array.isArray(page.items)
          ? page.items
              .map((item) => sanitizeShareableCanvasItem(item, options))
              .filter((item): item is ShareableCanvasItem => !!item)
          : [];
        return id ? { id, items, layouts: sanitizeLayouts(page.layouts) } : null;
      })
    : [];
  const cleanPages = pages.filter((page): page is NonNullable<typeof page> => !!page);
  if (!cleanPages.some((page) => page.items.length > 0)) return null;
  const authorProfile = sanitizeAuthorProfile(canvas.authorProfile);
  const generation = sanitizeGeneration(canvas.generation);
  return {
    id: trimText(canvas.id, 80) || "shared",
    author: trimText(canvas.author, SANITIZE_LIMITS.maxAuthorChars) || "Anonymous",
    ...(authorProfile ? { authorProfile } : {}),
    pages: cleanPages,
    ...(generation ? { generation } : {}),
    createdAt: trimText(canvas.createdAt, 40) || new Date().toISOString(),
    ...(typeof canvas.deleteTokenHash === "string" ? { deleteTokenHash: canvas.deleteTokenHash } : {}),
    ...((() => {
      const url = keepStoredPreviewUrl(canvas.previewUrl, SANITIZE_LIMITS.maxOgImageChars);
      return url ? { previewUrl: url } : {};
    })()),
  };
}

export function sanitizeGenerateRequestPayload(value: unknown): GenerateRequestPayload | null {
  if (!value || typeof value !== "object") return null;
  const rawItems = (value as Record<string, unknown>).items;
  if (!Array.isArray(rawItems)) return null;
  const items = rawItems
    .map((item): GenerateRequestItem | null => {
      if (!item || typeof item !== "object") return null;
      const type = trimText((item as Record<string, unknown>).type, 20);
      if (type === "url") return sanitizeUrlItem(item);
      if (type === "note") return sanitizeNoteItem(item);
      if (type === "image") return sanitizeShareRequestImageItem(item);
      return null;
    })
    .filter((item): item is GenerateRequestItem => !!item);
  return { items };
}
