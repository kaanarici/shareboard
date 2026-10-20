import { afterEach, describe, expect, test } from "bun:test";
import { PNG_SIGNATURE } from "@/test/fixtures";
import { decryptLockedBoard } from "./encrypted-share";
import { parseEncryptedEnvelope } from "./locked-envelope";
import { getBoardTitle, prepareLockedShare, prepareShare, shareRequest } from "./share-prepare";
import type { BoardPage } from "./types";

const layouts = { lg: [], sm: [] };
const author = { author: "Ada", authorProfile: { xUrl: "https://x.com/ada" } };
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function draftImage(id: string, bytes: BlobPart[] = [PNG_SIGNATURE, "png"], type = "image/png") {
  return { id, type: "image" as const, file: new File(bytes, `${id}.png`, { type }), previewUrl: `blob:${id}`, mimeType: type, size: 11 };
}

function sharedImage(id: string, objectKey: string) {
  return { id, type: "image" as const, objectKey, url: `/api/objects?key=${encodeURIComponent(objectKey)}`, mimeType: "image/png", size: 11 };
}

function stubFetch(seen: string[]) {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(new Blob([PNG_SIGNATURE, "remote"], { type: "image/png" }));
    },
    { preconnect: realFetch.preconnect },
  );
}

const textPages: BoardPage[] = [{ id: "p", layouts, items: [{ id: "n", type: "note", html: "<p>Hello <b>there</b></p>" }] }];

describe("share preparation", () => {
  test("share requests carry image metadata but never draft files or blob URLs", () => {
    const request = shareRequest([{ id: "p", layouts, items: [draftImage("img")] }], author);
    expect(request.pages[0]?.items).toEqual([{ id: "img", type: "image", mimeType: "image/png", size: 11 }]);
    expect(JSON.stringify(request)).not.toContain("blob:");
  });

  test("titles come from the first meaningful item", () => {
    expect(getBoardTitle(textPages)).toBe("Hello there");
    expect(getBoardTitle([{ items: [{ type: "json", name: "config.json" }] }])).toBe("config.json");
    expect(
      getBoardTitle([{ items: [{ type: "note", html: "<h2>Weekend trip</h2><p>Pack <strong>light</strong>. Tom &amp;amp; Jerry</p>" }] }]),
    ).toBe("Weekend trip");
    expect(getBoardTitle([{ items: [{ type: "url", url: "https://www.example.com/a" }] }])).toBe("example.com");
    expect(getBoardTitle([])).toBe("Untitled board");
  });

  test("text-only drafts and locked boards become tiny links; stored boards replace in place", async () => {
    const owner = { author, baseUrl: "https://s.test", isMobile: true, canStore: true };
    const tiny = await prepareShare({ ...owner, pages: textPages, boardOrigin: { kind: "draft" } });
    expect(tiny.kind === "tiny" && tiny.url.startsWith("https://s.test/s#b=")).toBe(true);

    const fromLocked = await prepareShare({ ...owner, pages: textPages, boardOrigin: { kind: "locked", id: "L" } });
    expect(fromLocked.kind).toBe("tiny");

    const stored = await prepareShare({ ...owner, pages: textPages, boardOrigin: { kind: "stored", id: "same" } });
    expect(stored.kind === "stored" && stored.isReplace).toBe(true);
    expect(stored.kind === "stored" && stored.form.get("replaceId")).toBe("same");
  });

  test("visitors only ever get link shares, even for a stored origin", async () => {
    const visitor = { author, baseUrl: "https://s.test", isMobile: true, canStore: false };
    const fromStored = await prepareShare({ ...visitor, pages: textPages, boardOrigin: { kind: "stored", id: "same" } });
    expect(fromStored.kind).toBe("tiny");
    const withImage: BoardPage[] = [{ id: "p", layouts, items: [draftImage("draft")] }];
    await expect(prepareShare({ ...visitor, pages: withImage, boardOrigin: { kind: "draft" } })).rejects.toThrow("too big for a link");
  });

  test("own images are reused on replace; imported or copied images are re-uploaded", async () => {
    const seen: string[] = [];
    stubFetch(seen);
    const pages: BoardPage[] = [
      {
        id: "p",
        layouts,
        items: [sharedImage("own", "images/board-1/abc"), sharedImage("foreign", "images/other/def"), draftImage("draft")],
      },
    ];
    const draft = await prepareShare({
      pages,
      boardOrigin: { kind: "stored", id: "board-1" },
      author,
      baseUrl: "https://s.test",
      isMobile: true,
      canStore: true,
    });
    if (draft.kind !== "stored") throw new Error("expected stored share");
    expect(draft.form.has("image:own")).toBe(false);
    expect(draft.form.get("reuse:own")).toBe("images/board-1/abc");
    expect(draft.form.get("image:foreign")).toBeInstanceOf(File);
    expect(draft.form.get("image:draft")).toBeInstanceOf(File);
    expect(seen).toEqual(["/api/objects?key=images%2Fother%2Fdef"]);

    const fresh = await prepareShare({ pages, boardOrigin: { kind: "draft" }, author, baseUrl: "https://s.test", isMobile: true, canStore: true });
    expect(fresh.kind === "stored" && fresh.form.has("image:own")).toBe(true);
  });

  test("locked shares encrypt only verified raster images and round-trip through decryption", async () => {
    const svg = draftImage("svg", ["<svg onload=alert(1)>"], "image/svg+xml");
    await expect(
      prepareLockedShare({ pages: [{ id: "p", layouts, items: [svg] }], boardOrigin: { kind: "draft" }, pin: "123456", author }),
    ).rejects.toThrow("Only verified PNG, JPEG, GIF, WebP, or AVIF uploads are allowed");

    const locked = await prepareLockedShare({
      pages: [{ id: "p", layouts, items: [{ id: "n", type: "note", html: "secret" }, draftImage("img")] }],
      boardOrigin: { kind: "draft" },
      pin: "123456",
      author,
    });
    const rawEnvelope = String(locked.form.get("encryptedPayload"));
    expect(rawEnvelope).not.toContain("secret");
    const encrypted = locked.form.get("encrypted-image:img");
    if (!(encrypted instanceof File)) throw new Error("expected encrypted image");

    const stored = JSON.parse(rawEnvelope);
    stored.images[0].key = "locked-images/abc";
    const envelope = parseEncryptedEnvelope(stored);
    if (!envelope) throw new Error("expected envelope");
    globalThis.fetch = Object.assign(async () => new Response(encrypted), { preconnect: realFetch.preconnect });
    const { canvas, dispose } = await decryptLockedBoard(envelope, "123456");
    const items = canvas.pages[0]?.items ?? [];
    expect(items[0]).toEqual({ id: "n", type: "note", html: "secret" });
    expect(items[1]).toMatchObject({ id: "img", type: "image", mimeType: "image/png" });
    dispose();
    await expect(decryptLockedBoard(envelope, "000000")).rejects.toThrow();
  });
});
