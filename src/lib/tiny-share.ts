import { base64UrlToBytes, bytesToBase64Url } from "@/lib/crypto";
import { boardAsJson, sanitizeTextBoard } from "@/lib/canvas-sanitize";
import { isRecord, parseJson } from "@/lib/json";
import type { Board } from "@/lib/types";

export const TINY_SHARE_PARAM = "b";
const TINY_SHARE_MAX_URL_CHARS = 7000;
export const TINY_SHARE_MAX_COMPRESSED_BYTES = 16 * 1024;
export const TINY_SHARE_MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024;

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

export async function createTinyShareUrl(board: Board, origin: string) {
  const textOnly = board.pages.every((page) => page.items.every((item) => item.type !== "image"));
  const safeBoard = textOnly ? sanitizeTextBoard(boardAsJson(board)) : null;
  if (!safeBoard) return null;
  const compressed = await gzip(textEncoder.encode(JSON.stringify({ v: 1, canvas: boardAsJson(safeBoard) })));
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
  const parsed = parseJson(new TextDecoder().decode(decompressed));
  return isRecord(parsed) && parsed.v === 1 ? sanitizeTextBoard(parsed.canvas) : null;
}

export function readTinyPayloadFromUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hashIdx = trimmed.indexOf("#");
  const hash = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : trimmed;
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  return params.get(TINY_SHARE_PARAM);
}
