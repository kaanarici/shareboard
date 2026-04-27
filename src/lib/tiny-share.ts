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
