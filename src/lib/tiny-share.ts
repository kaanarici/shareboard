import type {
  AuthorProfile,
  Canvas,
  GenerateResponse,
  GridLayouts,
  OGData,
  Platform,
  SharedCanvasItem,
} from "@/lib/types";

export const TINY_SHARE_PARAM = "b";
export const TINY_SHARE_MAX_URL_CHARS = 7000;

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

type TinyEnvelope = {
  v: 1;
  canvas: Canvas;
};

function trimText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function keepHttpUrl(value: unknown, max: number) {
  const raw = trimText(value, max);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function gzip(bytes: Uint8Array) {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array) {
  if (typeof DecompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function sanitizeLayouts(value: unknown): GridLayouts | undefined {
  if (!value || typeof value !== "object") return undefined;
  const layouts = value as Record<string, unknown>;
  const sanitize = (input: unknown) =>
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
  return { lg: sanitize(layouts.lg), sm: sanitize(layouts.sm) };
}

function sanitizeProfile(value: unknown): AuthorProfile | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const profile: AuthorProfile = {};
  const xUrl = keepHttpUrl(input.xUrl, 2048);
  const instagramUrl = keepHttpUrl(input.instagramUrl, 2048);
  const linkedinUrl = keepHttpUrl(input.linkedinUrl, 2048);
  if (xUrl) profile.xUrl = xUrl;
  if (instagramUrl) profile.instagramUrl = instagramUrl;
  if (linkedinUrl) profile.linkedinUrl = linkedinUrl;
  return Object.keys(profile).length ? profile : undefined;
}

function sanitizeOgData(value: unknown): OGData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const title = trimText(input.title, 300);
  const description = trimText(input.description, 300);
  const image = keepHttpUrl(input.image, 2048);
  const siteName = trimText(input.siteName, 120);
  const author = trimText(input.author, 120);
  if (!title && !description && !image && !siteName && !author) return undefined;
  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(siteName ? { siteName } : {}),
    ...(author ? { author } : {}),
  };
}

function sanitizeGeneration(value: unknown): GenerateResponse | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const overall = input.overall_summary;
  if (!overall || typeof overall !== "object") return undefined;
  const summary = overall as Record<string, unknown>;
  return {
    item_summaries: Array.isArray(input.item_summaries)
      ? input.item_summaries
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const item = entry as Record<string, unknown>;
            const item_id = trimText(item.item_id, 80);
            const title = trimText(item.title, 160);
            const summaryText = trimText(item.summary, 800);
            if (!item_id || !title || !summaryText) return null;
            return { item_id, title, summary: summaryText };
          })
          .filter((entry): entry is NonNullable<typeof entry> => !!entry)
      : [],
    overall_summary: {
      title: trimText(summary.title, 160) || "Shareboard",
      explanation: trimText(summary.explanation, 12000),
      tags: Array.isArray(summary.tags)
        ? summary.tags.map((tag) => trimText(tag, 40)).filter(Boolean).slice(0, 8)
        : [],
    },
  };
}

function sanitizeItem(value: unknown): SharedCanvasItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = trimText(item.id, 80);
  const type = trimText(item.type, 20);
  if (!id) return null;

  if (type === "note") {
    const text = trimText(item.text, 20000);
    return text ? { id, type: "note", text } : null;
  }

  if (type === "url") {
    const url = keepHttpUrl(item.url, 4096);
    const platform = trimText(item.platform, 40);
    if (!url || !PLATFORMS.has(platform as Platform)) return null;
    const ogData = sanitizeOgData(item.ogData);
    return {
      id,
      type: "url",
      url,
      platform: platform as Platform,
      ...(ogData ? { ogData } : {}),
    };
  }

  return null;
}

function sanitizeCanvas(value: unknown): Canvas | null {
  if (!value || typeof value !== "object") return null;
  const canvas = value as Record<string, unknown>;
  const rawPages = Array.isArray(canvas.pages) ? canvas.pages : [];
  const pages = rawPages
    .slice(0, 12)
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const page = entry as Record<string, unknown>;
      const id = trimText(page.id, 80);
      const items = Array.isArray(page.items)
        ? page.items.slice(0, 60).map(sanitizeItem).filter((item): item is SharedCanvasItem => !!item)
        : [];
      if (!id) return null;
      return { id, items, layouts: sanitizeLayouts(page.layouts) };
    })
    .filter((page): page is NonNullable<typeof page> => !!page);

  if (!pages.some((page) => page.items.length > 0)) return null;
  const authorProfile = sanitizeProfile(canvas.authorProfile);
  const generation = sanitizeGeneration(canvas.generation);

  return {
    id: trimText(canvas.id, 80) || "tiny",
    author: trimText(canvas.author, 80) || "Anonymous",
    ...(authorProfile ? { authorProfile } : {}),
    pages,
    ...(generation ? { generation } : {}),
    createdAt: trimText(canvas.createdAt, 40) || new Date().toISOString(),
  };
}

export function canUseTinyShare(canvas: Canvas) {
  return canvas.pages.every((page) => page.items.every((item) => item.type === "url" || item.type === "note"));
}

export async function createTinyShareUrl(canvas: Canvas, origin: string) {
  if (!canUseTinyShare(canvas)) return null;
  const compressed = await gzip(new TextEncoder().encode(JSON.stringify({ v: 1, canvas } satisfies TinyEnvelope)));
  if (!compressed) return null;
  const url = `${origin}/s#${TINY_SHARE_PARAM}=${bytesToBase64Url(compressed)}`;
  return url.length <= TINY_SHARE_MAX_URL_CHARS ? url : null;
}

export async function decodeTinyShare(value: string) {
  const bytes = base64UrlToBytes(value);
  const decompressed = await gunzip(bytes);
  if (!decompressed) return null;
  const parsed = JSON.parse(new TextDecoder().decode(decompressed)) as unknown;
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as Partial<TinyEnvelope>;
  return envelope.v === 1 ? sanitizeCanvas(envelope.canvas) : null;
}
