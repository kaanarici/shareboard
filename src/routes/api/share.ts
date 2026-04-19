import { randomBytes, createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { createFileRoute } from "@tanstack/react-router";
import { deleteObject, getObjectKeyFromPublicUrl, getObjectText, putBuffer, putObject } from "@/lib/r2";
import { takeRateLimit } from "@/lib/rate-limit";
import type {
  AuthorProfile,
  Canvas,
  GenerateResponse,
  GridLayouts,
  OGData,
  Platform,
  SharedBoardPage,
  SharedCanvasItem,
  UrlItem,
} from "@/lib/types";

const SHARE_LIMITS = {
  maxPages: 12,
  maxItemsPerPage: 60,
  maxImages: 32,
  maxImageBytes: 8 * 1024 * 1024,
  maxTotalImageBytes: 48 * 1024 * 1024,
  maxAuthorChars: 80,
  maxUrlChars: 4096,
  maxNoteChars: 20000,
  maxSummaryChars: 12000,
  maxSummaryItemChars: 800,
  maxTags: 8,
  maxOgTextChars: 300,
  maxOgImageChars: 2048,
} as const;

const PLATFORMS = new Set<Platform>([
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

type SharePayload = {
  author?: unknown;
  authorProfile?: unknown;
  generation?: unknown;
  pages?: unknown;
};

const MAX_SOCIAL_URL = 2048;

function isSocialHost(url: string, kind: "x" | "instagram" | "linkedin"): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  if (kind === "x") {
    return host === "x.com" || host === "twitter.com" || host.endsWith(".twitter.com");
  }
  if (kind === "instagram") {
    return host === "instagram.com" || host.endsWith(".instagram.com");
  }
  if (kind === "linkedin") {
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  }
  return false;
}

function sanitizeAuthorProfile(value: unknown): AuthorProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Record<string, unknown>;
  const out: AuthorProfile = {};

  const xUrl = keepHttpUrl(o.xUrl, MAX_SOCIAL_URL);
  if (xUrl && isSocialHost(xUrl, "x")) out.xUrl = xUrl;

  const instagramUrl = keepHttpUrl(o.instagramUrl, MAX_SOCIAL_URL);
  if (instagramUrl && isSocialHost(instagramUrl, "instagram")) out.instagramUrl = instagramUrl;

  const linkedinUrl = keepHttpUrl(o.linkedinUrl, MAX_SOCIAL_URL);
  if (linkedinUrl && isSocialHost(linkedinUrl, "linkedin")) out.linkedinUrl = linkedinUrl;

  return Object.keys(out).length ? out : undefined;
}

type ShareImageItem = {
  id: string;
  type: "image";
  mimeType?: string;
  caption?: string;
};

function getClientIp(request: Request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function trimText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function keepHttpUrl(value: unknown, max: number) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sanitizeOgData(value: unknown): OGData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const og = value as Record<string, unknown>;
  const title = trimText(og.title, SHARE_LIMITS.maxOgTextChars);
  const description = trimText(og.description, SHARE_LIMITS.maxOgTextChars);
  const image = keepHttpUrl(og.image, SHARE_LIMITS.maxOgImageChars);
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

function sanitizeLayouts(value: unknown): GridLayouts | undefined {
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

function sanitizeGeneration(value: unknown): GenerateResponse | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const itemSummaries = Array.isArray(input.item_summaries)
    ? input.item_summaries
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const item = entry as Record<string, unknown>;
          const item_id = trimText(item.item_id, 80);
          const title = trimText(item.title, 160);
          const summary = trimText(item.summary, SHARE_LIMITS.maxSummaryItemChars);
          if (!item_id || !title || !summary) return null;
          return { item_id, title, summary };
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
      explanation: trimText(summary.explanation, SHARE_LIMITS.maxSummaryChars),
      tags: Array.isArray(summary.tags)
        ? summary.tags
            .map((tag) => trimText(tag, 40))
            .filter(Boolean)
            .slice(0, SHARE_LIMITS.maxTags)
        : [],
    },
  };
}

function sanitizeUrlItem(value: Record<string, unknown>): UrlItem | null {
  const id = trimText(value.id, 80);
  const url = keepHttpUrl(value.url, SHARE_LIMITS.maxUrlChars);
  const platform = trimText(value.platform, 40);
  if (!id || !url || !PLATFORMS.has(platform as Platform)) return null;

  return {
    id,
    type: "url",
    url,
    platform: platform as Platform,
    ogData: sanitizeOgData(value.ogData),
  };
}

function sanitizeNoteItem(value: Record<string, unknown>) {
  const id = trimText(value.id, 80);
  const text = trimText(value.text, SHARE_LIMITS.maxNoteChars);
  if (!id || !text) return null;
  return { id, type: "note" as const, text };
}

function sanitizeImageItem(value: Record<string, unknown>): ShareImageItem | null {
  const id = trimText(value.id, 80);
  const mimeType = trimText(value.mimeType, 120) || undefined;
  const caption = trimText(value.caption, 300) || undefined;
  if (!id) return null;
  return { id, type: "image", mimeType, caption };
}

function parsePayload(raw: string | undefined) {
  if (!raw) throw new Error("Missing payload");
  const payload = JSON.parse(raw) as SharePayload;
  if (!Array.isArray(payload.pages) || payload.pages.length === 0) {
    throw new Error("Board must include at least one page");
  }
  if (payload.pages.length > SHARE_LIMITS.maxPages) {
    throw new Error(`Board is too large (max ${SHARE_LIMITS.maxPages} pages)`);
  }
  return payload;
}

/** Counters shared across pages to enforce board-wide image caps. */
type ImageCounters = { count: number; bytes: number };

async function buildSharedItems(
  canvasId: string,
  pageId: string,
  rawItems: unknown[],
  files: Map<string, File>,
  uploadedKeys: string[],
  counters: ImageCounters
): Promise<SharedCanvasItem[]> {
  if (rawItems.length > SHARE_LIMITS.maxItemsPerPage) {
    throw new Error(`A page can hold at most ${SHARE_LIMITS.maxItemsPerPage} items`);
  }
  const items: SharedCanvasItem[] = [];

  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== "object") {
      throw new Error("Invalid board item");
    }

    const item = rawItem as Record<string, unknown>;
    const type = trimText(item.type, 20);

    if (type === "board_summary") {
      continue;
    }

    if (type === "url") {
      const sanitized = sanitizeUrlItem(item);
      if (!sanitized) throw new Error("Invalid URL item");
      items.push(sanitized);
      continue;
    }

    if (type === "note") {
      const sanitized = sanitizeNoteItem(item);
      if (!sanitized) throw new Error("Invalid note item");
      items.push(sanitized);
      continue;
    }

    if (type === "image") {
      counters.count += 1;
      if (counters.count > SHARE_LIMITS.maxImages) {
        throw new Error(`Too many images (max ${SHARE_LIMITS.maxImages})`);
      }

      const sanitized = sanitizeImageItem(item);
      if (!sanitized) throw new Error("Invalid image item");
      const file = files.get(sanitized.id);
      if (!file) throw new Error(`Missing image upload for item ${sanitized.id}`);
      if (!file.type.startsWith("image/")) throw new Error("Only image uploads are allowed");
      if (file.size > SHARE_LIMITS.maxImageBytes) {
        throw new Error(`Image ${sanitized.id} exceeds ${Math.floor(SHARE_LIMITS.maxImageBytes / 1024 / 1024)} MB`);
      }

      counters.bytes += file.size;
      if (counters.bytes > SHARE_LIMITS.maxTotalImageBytes) {
        throw new Error(`Images exceed ${Math.floor(SHARE_LIMITS.maxTotalImageBytes / 1024 / 1024)} MB total`);
      }

      const key = `images/${canvasId}/${pageId}/${sanitized.id}`;
      const bytes = Buffer.from(await file.arrayBuffer());
      const mimeType = file.type || sanitized.mimeType || "application/octet-stream";
      const url = await putBuffer(key, bytes, mimeType);
      uploadedKeys.push(key);
      items.push({
        id: sanitized.id,
        type: "image",
        url,
        mimeType,
        caption: sanitized.caption,
      });
      continue;
    }

    throw new Error("Unsupported board item");
  }

  return items;
}

async function buildSharedPages(
  canvasId: string,
  rawPages: unknown[],
  files: Map<string, File>,
  uploadedKeys: string[]
): Promise<SharedBoardPage[]> {
  const counters: ImageCounters = { count: 0, bytes: 0 };
  const pages: SharedBoardPage[] = [];

  for (let i = 0; i < rawPages.length; i++) {
    const raw = rawPages[i];
    if (!raw || typeof raw !== "object") {
      throw new Error(`Invalid page at index ${i}`);
    }
    const page = raw as Record<string, unknown>;
    const id = trimText(page.id, 80);
    if (!id) throw new Error(`Page at index ${i} missing id`);

    const rawItems = Array.isArray(page.items) ? page.items : [];
    const items = await buildSharedItems(canvasId, id, rawItems, files, uploadedKeys, counters);
    const layouts = sanitizeLayouts(page.layouts);

    pages.push({ id, items, ...(layouts ? { layouts } : {}) });
  }

  if (!pages.some((p) => p.items.length > 0)) {
    throw new Error("Board must include at least one item");
  }

  return pages;
}

export const Route = createFileRoute("/api/share")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ip = getClientIp(request);
        const rate = takeRateLimit(`share:${ip}`, 20, 10 * 60 * 1000);
        if (!rate.ok) {
          return Response.json(
            { error: "Too many share attempts. Try again shortly." },
            { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
          );
        }

        const uploadedKeys: string[] = [];
        try {
          const form = await request.formData();
          const payload = parsePayload(form.get("payload")?.toString());

          const files = new Map<string, File>();
          for (const [key, value] of form.entries()) {
            if (!key.startsWith("image:") || !(value instanceof File)) continue;
            files.set(key.slice("image:".length), value);
          }

          const id = nanoid(10);
          const deleteToken = randomBytes(24).toString("base64url");
          const pages = await buildSharedPages(id, payload.pages as unknown[], files, uploadedKeys);

          const authorProfile = sanitizeAuthorProfile(payload.authorProfile);

          const canvas: Canvas = {
            id,
            author: trimText(payload.author, SHARE_LIMITS.maxAuthorChars) || "Anonymous",
            ...(authorProfile ? { authorProfile } : {}),
            pages,
            generation: sanitizeGeneration(payload.generation),
            createdAt: new Date().toISOString(),
            deleteTokenHash: hashToken(deleteToken),
          };

          await putObject(`canvases/${id}.json`, JSON.stringify(canvas));
          return Response.json({ id, deleteToken });
        } catch (error) {
          await Promise.all(uploadedKeys.map((key) => deleteObject(key).catch(() => undefined)));
          const message = error instanceof Error ? error.message : "Failed to share board";
          const status =
            /too many|exceed|invalid|missing|unsupported|must include|only image/i.test(message) ? 400 : 500;
          return Response.json({ error: message }, { status });
        }
      },

      DELETE: async ({ request }) => {
        const ip = getClientIp(request);
        const rate = takeRateLimit(`share-delete:${ip}`, 10, 10 * 60 * 1000);
        if (!rate.ok) {
          return Response.json(
            { error: "Too many delete attempts. Try again shortly." },
            { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
          );
        }

        const url = new URL(request.url);
        const id = trimText(url.searchParams.get("id"), 80);
        const token =
          trimText(url.searchParams.get("token"), 200) ||
          trimText(request.headers.get("x-delete-token"), 200);

        if (!id || !token) {
          return Response.json({ error: "Missing board id or delete token" }, { status: 400 });
        }

        try {
          const raw = await getObjectText(`canvases/${id}.json`);
          if (!raw) {
            return Response.json({ error: "Board not found" }, { status: 404 });
          }

          const canvas = JSON.parse(raw) as Canvas;
          if (!canvas.deleteTokenHash || canvas.deleteTokenHash !== hashToken(token)) {
            return Response.json({ error: "Invalid delete token" }, { status: 403 });
          }

          const keys = canvas.pages
            .flatMap((page) => page.items)
            .filter((item): item is Extract<SharedCanvasItem, { type: "image" }> => item.type === "image")
            .map((item) => getObjectKeyFromPublicUrl(item.url))
            .filter((key): key is string => !!key);

          await Promise.all(keys.map((key) => deleteObject(key)));
          await deleteObject(`canvases/${id}.json`);

          return Response.json({ ok: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to delete board";
          return Response.json({ error: message }, { status: 500 });
        }
      },
    },
  },
});
