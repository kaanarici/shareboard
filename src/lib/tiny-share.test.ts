import { describe, expect, test } from "bun:test";
import { base64UrlToBytes, bytesToBase64Url } from "./crypto";
import { boardAsJson, sanitizeTextBoard } from "./canvas-sanitize";
import { parseJson } from "./json";
import {
  createTinyShareUrl,
  decodeTinyShare,
  readTinyPayloadFromUrl,
  TINY_SHARE_MAX_COMPRESSED_BYTES,
  TINY_SHARE_MAX_DECOMPRESSED_BYTES,
} from "./tiny-share";
import type { Board } from "./types";

const origin = "https://share.example";
const textEncoder = new TextEncoder();
const fixedV1Payload =
  "H4sIAAAAAAAAA02NsQqDQBBE_2XqNawpLLbzH1JFLA5vo8Lpia4Skfv3oAQSGBhe8WYObJCc0LhxcwvkQO8hePVv9SC41bo4Q1B6B0IzqzP1pUFw53uRcZFx_mCWKzdmfoIwuVYXSPUdOxGE4Pa42vURWkhVE5bh7EToTYc_Y4x2GrZP-qPOhgBBpyFEpDrVKX0Apcc6OL4AAAA";

const tinyCanvas: Board = {
  id: "tiny",
  author: "Ada",
  createdAt: "2026-06-01T00:00:00.000Z",
  pages: [
    {
      id: "page",
      layouts: { lg: [], sm: [] },
      items: [{ id: "note", type: "note", html: "hello" }],
    },
  ],
};

const fixedV1Canvas: Board = {
  id: "fixed",
  author: "Ada",
  createdAt: "2026-06-01T00:00:00.000Z",
  pages: [
    {
      id: "page",
      layouts: { lg: [], sm: [] },
      items: [{ id: "note", type: "note", html: "hello" }],
    },
  ],
};

async function gzipBytes(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipText(payload: string): Promise<string> {
  const stream = new Blob([base64UrlToBytes(payload)]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function requireSanitized(canvas: Board): Board {
  const sanitized = sanitizeTextBoard(boardAsJson(canvas));
  if (!sanitized) throw new Error("expected canvas to sanitize");
  return sanitized;
}

function requirePayload(url: string | null): string {
  const payload = url ? readTinyPayloadFromUrl(url) : null;
  if (!payload) throw new Error("expected tiny-share payload");
  return payload;
}

describe("tiny-share decode", () => {
  test("round trips generated v1 tiny shares", async () => {
    const url = await createTinyShareUrl(tinyCanvas, origin);
    const payload = requirePayload(url);
    const envelope = parseJson(await gunzipText(payload));
    const sanitized = requireSanitized(tinyCanvas);

    expect(envelope).toEqual({ v: 1, canvas: sanitized });
    expect(await decodeTinyShare(payload)).toEqual(sanitized);
  });

  test("decodes fixed v1 payloads", async () => {
    expect(await decodeTinyShare(fixedV1Payload)).toEqual(requireSanitized(fixedV1Canvas));
  });

  test("rejects oversized compressed input", async () => {
    const payload = bytesToBase64Url(new Uint8Array(TINY_SHARE_MAX_COMPRESSED_BYTES + 1));

    expect(await decodeTinyShare(payload)).toBeNull();
  });

  test("rejects tiny-share zip bombs over the decompressed cap", async () => {
    const compressed = await gzipBytes(new Uint8Array(TINY_SHARE_MAX_DECOMPRESSED_BYTES + 1));

    expect(compressed.byteLength).toBeLessThan(TINY_SHARE_MAX_COMPRESSED_BYTES);
    expect(await decodeTinyShare(bytesToBase64Url(compressed))).toBeNull();
  });

  test("rejects unknown tiny-share envelope versions", async () => {
    const compressed = await gzipBytes(textEncoder.encode(JSON.stringify({ v: 99, canvas: tinyCanvas })));

    expect(await decodeTinyShare(bytesToBase64Url(compressed))).toBeNull();
  });

  test("rejects invalid tiny-share input", async () => {
    const invalidJson = await gzipBytes(textEncoder.encode("{not json"));

    expect(await decodeTinyShare("not%base64")).toBeNull();
    expect(await decodeTinyShare(bytesToBase64Url(textEncoder.encode("not gzip")))).toBeNull();
    expect(await decodeTinyShare(bytesToBase64Url(invalidJson))).toBeNull();
  });
});
