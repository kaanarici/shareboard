import { describe, expect, test } from "bun:test";
import { base64UrlToBytes, bytesToBase64Url } from "./base64url";
import { sanitizeTinyCanvas } from "./canvas-sanitize";
import {
  createTinyShareUrl,
  decodeTinyShare,
  readTinyPayloadFromUrl,
  TINY_SHARE_MAX_COMPRESSED_BYTES,
  TINY_SHARE_MAX_DECOMPRESSED_BYTES,
} from "./tiny-share";
import type { Canvas } from "./types";

const origin = "https://share.example";
const textEncoder = new TextEncoder();
const tinyLimits = { maxPages: 12, maxItemsPerPage: 60 };
const fixedV1Payload =
  "H4sIAAAAAAAAE03KsQqDQBCE4XeZ-gyrhcV2vkOqBIvlblHh4oluJCL37uFCCmGa_2NO7ODawcu8ywY-MQUwog7iDzjI28a0gtEFgcMig27g5_9WEg6T6euic7Kidix6Kf0YGKPGmJD73Dv4VcU0dMUbatqK2orqOxH_diOiB3L-An_E8g6jAAAA";

const tinyCanvas: Canvas = {
  id: "tiny",
  author: "Ada",
  createdAt: "2026-06-01T00:00:00.000Z",
  pages: [
    {
      id: "page",
      items: [{ id: "note", type: "note", text: "hello" }],
    },
  ],
};

const legacyV1Canvas: Canvas = {
  id: "legacy",
  author: "Ada",
  createdAt: "2026-06-01T00:00:00.000Z",
  pages: [
    {
      id: "page",
      items: [{ id: "note", type: "note", text: "hello" }],
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

function requireSanitized(canvas: Canvas): Canvas {
  const sanitized = sanitizeTinyCanvas(canvas, tinyLimits);
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
    const envelope = JSON.parse(await gunzipText(payload)) as { v?: unknown; canvas?: unknown };
    const sanitized = requireSanitized(tinyCanvas);

    expect(envelope).toEqual({ v: 1, canvas: sanitized });
    expect(await decodeTinyShare(payload)).toEqual(sanitized);
  });

  test("decodes fixed v1 payloads", async () => {
    expect(await decodeTinyShare(fixedV1Payload)).toEqual(requireSanitized(legacyV1Canvas));
  });

  test("decodes v1 payloads while stripping legacy generation and board summaries", async () => {
    const legacyPayload = {
      v: 1,
      canvas: {
        id: "legacy",
        author: "Ada",
        createdAt: "2026-06-01T00:00:00.000Z",
        generation: {
          item_summaries: [],
          overall_summary: { title: "Summary", explanation: "Text", tags: [] },
        },
        pages: [
          {
            id: "page",
            items: [
              { id: "__summary__", type: "board_summary" },
              { id: "note", type: "note", text: "hello" },
            ],
            layouts: {
              lg: [
                { i: "__summary__", x: 0, y: 0, w: 6, h: 4 },
                { i: "note", x: 6, y: 0, w: 6, h: 4 },
              ],
              sm: [{ i: "__summary__", x: 0, y: 0, w: 1, h: 4 }],
            },
          },
        ],
      },
    };
    const payload = bytesToBase64Url(await gzipBytes(textEncoder.encode(JSON.stringify(legacyPayload))));

    expect(await decodeTinyShare(payload)).toEqual({
      id: "legacy",
      author: "Ada",
      createdAt: "2026-06-01T00:00:00.000Z",
      pages: [
        {
          id: "page",
          items: [{ id: "note", type: "note", text: "hello" }],
          layouts: { lg: [{ i: "note", x: 6, y: 0, w: 6, h: 4 }], sm: [] },
        },
      ],
    });
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
