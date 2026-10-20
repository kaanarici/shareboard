import { afterEach, describe, expect, test } from "bun:test";
import { createLockedSharePackage, decryptLockedBoard } from "./encrypted-share";
import { parseEncryptedEnvelope } from "./locked-envelope";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("locked board decryption", () => {
  test("drops decrypted images that are not verified raster bytes, whatever their declared type", async () => {
    const html = new TextEncoder().encode("<html><script>steal(indexedDB)</script></html>");
    const pkg = await createLockedSharePackage(
      "123456",
      {
        id: "LockedBoardId123456789",
        author: "Mallory",
        createdAt: "2026-10-01T00:00:00.000Z",
        pages: [
          {
            id: "p",
            layouts: { lg: [{ i: "evil", x: 0, y: 0, w: 4, h: 4 }], sm: [] },
            items: [
              { id: "evil", type: "image", mimeType: "text/html" },
              { id: "note", type: "note", html: "hi" },
            ],
          },
        ],
      },
      [{ id: "evil", pageId: "p", bytes: html }],
    );
    const envelope = parseEncryptedEnvelope({
      ...pkg.envelope,
      images: pkg.envelope.images.map((image) => ({ ...image, key: "locked-images/evil" })),
    });
    if (!envelope) throw new Error("expected envelope");
    const encrypted = pkg.files[0]?.data;
    if (!encrypted) throw new Error("expected encrypted file");
    globalThis.fetch = Object.assign(async () => new Response(encrypted), { preconnect: realFetch.preconnect });

    const { canvas } = await decryptLockedBoard(envelope, "123456");
    expect(canvas.pages[0]?.items).toEqual([{ id: "note", type: "note", html: "hi" }]);
    expect(canvas.pages[0]?.layouts.lg).toEqual([]);
  });
});
