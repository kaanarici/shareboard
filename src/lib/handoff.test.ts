import { describe, expect, test } from "bun:test";
import { base64UrlToBytes } from "./base64url";
import { sanitizePublicCanvasManifest } from "./canvas-sanitize";
import {
  HANDOFF_CODE_ALPHABET,
  HANDOFF_CODE_LENGTH,
  createHandoffStorageId,
  createHandoffPackage,
  decryptHandoff,
  encodeHandoffUrl,
  formatHandoffCode,
  generateHandoffCode,
  normalizeHandoffCode,
  parseHandoffFragment,
} from "./handoff";
import type { Canvas } from "./types";

const canvas: Canvas = {
  id: "board-1",
  author: "Ada",
  pages: [
    {
      id: "page-1",
      items: [{ id: "note-1", type: "note", text: "hello from device A" }],
    },
  ],
  createdAt: "2026-06-12T12:00:00.000Z",
};

describe("handoff client crypto", () => {
  test("generates typeable codes from the non-ambiguous alphabet", () => {
    const alphabet = new Set(HANDOFF_CODE_ALPHABET);
    const codes = Array.from({ length: 80 }, generateHandoffCode);

    expect(codes.every((code) => code.length === HANDOFF_CODE_LENGTH)).toBe(true);
    expect(codes.every((code) => [...code].every((char) => alphabet.has(char)))).toBe(true);
    expect(codes.some((code) => /[O0I1L]/.test(code))).toBe(false);
    expect(new Set(codes).size).toBeGreaterThan(75);
  });

  test("normalizes and formats handoff codes", () => {
    expect(normalizeHandoffCode("k7qx m3pd-w8rt")).toBe("K7QXM3PDW8RT");
    expect(formatHandoffCode("k7qx m3pd-w8rt")).toBe("K7QX-M3PD-W8RT");
    expect(normalizeHandoffCode("O0IL-M3PD-W8RT")).toBeNull();
  });

  test("round-trips a sanitized canvas with a code-derived AES-GCM key", async () => {
    const pkg = await createHandoffPackage(canvas);
    const decrypted = await decryptHandoff(pkg.ciphertext, pkg.code, pkg.iv, pkg.salt);
    const safeCanvas = sanitizePublicCanvasManifest(canvas, { allowBoardSummary: true });

    expect(decrypted).toEqual(safeCanvas);
    expect(await createHandoffStorageId(pkg.code)).toBe(pkg.storageId);
    expect(base64UrlToBytes(pkg.storageId).byteLength).toBe(32);
    expect(base64UrlToBytes(pkg.salt).byteLength).toBe(16);
  });

  test("returns null when the code is wrong", async () => {
    const pkg = await createHandoffPackage(canvas);
    const wrong = await createHandoffPackage(canvas);

    await expect(decryptHandoff(pkg.ciphertext, wrong.code, pkg.iv, pkg.salt)).resolves.toBeNull();
  });

  test("encodes and parses the code-only handoff URL", () => {
    const url = encodeHandoffUrl("https://shareboard.test/", "k7qx m3pd-w8rt");

    expect(url).toBe("https://shareboard.test/h#c=K7QX-M3PD-W8RT");
    expect(parseHandoffFragment(new URL(url).hash)).toBe("K7QXM3PDW8RT");
  });

  test("rejects malformed fragments", () => {
    expect(parseHandoffFragment("#c=O0IL-M3PD-W8RT")).toBeNull();
    expect(parseHandoffFragment("#c=K7QX-M3PD")).toBeNull();
    expect(parseHandoffFragment("#k=not-a-code")).toBeNull();
    expect(() => encodeHandoffUrl("https://shareboard.test", "O0IL-M3PD-W8RT")).toThrow();
  });
});
