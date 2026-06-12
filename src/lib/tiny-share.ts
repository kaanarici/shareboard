import { base64UrlToBytes, bytesToBase64Url } from "@/lib/base64url";
import { sanitizeTinyCanvas } from "@/lib/canvas-sanitize";
import type { Canvas } from "@/lib/types";

export const TINY_SHARE_PARAM = "b";
export const TINY_SHARE_MAX_URL_CHARS = 7000;
export const TINY_SHARE_MAX_COMPRESSED_BYTES = 16 * 1024;
export const TINY_SHARE_MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024;

const TINY_MAX_PAGES = 12;
const TINY_MAX_ITEMS_PER_PAGE = 60;

type TinyEnvelope = {
  v: 1;
  canvas: Canvas;
};

type TinyDecodedEnvelope = Partial<TinyEnvelope>;

const textEncoder = new TextEncoder();

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof DecompressionStream === "undefined") return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return readBoundedStream(stream, TINY_SHARE_MAX_DECOMPRESSED_BYTES);
}

function decodedBase64UrlByteLength(value: string): number | null {
  const unpadded = value.trim().replace(/=+$/, "");
  if (!/^[A-Za-z0-9_-]*$/.test(unpadded) || unpadded.length % 4 === 1) return null;
  const remainder = unpadded.length % 4;
  return Math.floor(unpadded.length / 4) * 3 + (remainder === 0 ? 0 : remainder - 1);
}

export function canUseTinyShare(canvas: Canvas) {
  return canvas.pages.every((page) =>
    page.items.every((item) => item.type === "url" || item.type === "note" || item.type === "json"),
  );
}

export async function createTinyShareUrl(canvas: Canvas, origin: string) {
  if (!canUseTinyShare(canvas)) return null;
  const safeCanvas = sanitizeTinyCanvas(canvas, {
    maxPages: TINY_MAX_PAGES,
    maxItemsPerPage: TINY_MAX_ITEMS_PER_PAGE,
  });
  if (!safeCanvas) return null;
  const compressed = await gzip(textEncoder.encode(JSON.stringify({ v: 1, canvas: safeCanvas } satisfies TinyEnvelope)));
  if (!compressed) return null;
  const url = `${origin}/s#${TINY_SHARE_PARAM}=${bytesToBase64Url(compressed)}`;
  return url.length <= TINY_SHARE_MAX_URL_CHARS ? url : null;
}

export async function decodeTinyShare(value: string) {
  const decodedLength = decodedBase64UrlByteLength(value);
  if (decodedLength === null || decodedLength > TINY_SHARE_MAX_COMPRESSED_BYTES) return null;

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = base64UrlToBytes(value);
  } catch {
    return null;
  }
  if (bytes.byteLength > TINY_SHARE_MAX_COMPRESSED_BYTES) return null;

  const decompressed = await gunzip(bytes);
  if (!decompressed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(decompressed)) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as TinyDecodedEnvelope;
  if (envelope.v === 1) {
    return sanitizeTinyCanvas(envelope.canvas, { maxPages: TINY_MAX_PAGES, maxItemsPerPage: TINY_MAX_ITEMS_PER_PAGE });
  }
  return null;
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
