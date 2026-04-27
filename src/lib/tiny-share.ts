import { base64UrlToBytes, bytesToBase64Url } from "@/lib/base64url";
import { sanitizeTinyCanvas } from "@/lib/canvas-sanitize";
import type { Canvas } from "@/lib/types";

export const TINY_SHARE_PARAM = "b";
export const TINY_SHARE_MAX_URL_CHARS = 7000;

const TINY_MAX_PAGES = 12;
const TINY_MAX_ITEMS_PER_PAGE = 60;

type TinyEnvelope = {
  v: 1;
  canvas: Canvas;
};

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof DecompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function canUseTinyShare(canvas: Canvas) {
  return canvas.pages.every((page) => page.items.every((item) => item.type === "url" || item.type === "note"));
}

export async function createTinyShareUrl(canvas: Canvas, origin: string) {
  if (!canUseTinyShare(canvas)) return null;
  const safeCanvas = sanitizeTinyCanvas(canvas, {
    maxPages: TINY_MAX_PAGES,
    maxItemsPerPage: TINY_MAX_ITEMS_PER_PAGE,
  });
  if (!safeCanvas) return null;
  const compressed = await gzip(
    new TextEncoder().encode(JSON.stringify({ v: 1, canvas: safeCanvas } satisfies TinyEnvelope)),
  );
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
  return envelope.v === 1
    ? sanitizeTinyCanvas(envelope.canvas, { maxPages: TINY_MAX_PAGES, maxItemsPerPage: TINY_MAX_ITEMS_PER_PAGE })
    : null;
}

/** Pull the `b=...` payload from a shareboard tiny-share URL or hash fragment. */
export function readTinyPayloadFromUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hashIdx = trimmed.indexOf("#");
  const hash = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : trimmed;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get(TINY_SHARE_PARAM);
}

/** Extract a stored-board id from a `/c/<id>` share URL. */
export function readStoredShareId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    const match = url.pathname.match(/\/c\/([A-Za-z0-9_-]+)\/?$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
