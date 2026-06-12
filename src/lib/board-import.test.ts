import { afterEach, describe, expect, test } from "bun:test";
import { importFromUrl } from "./board-import";
import { createHandoffPackage, createHandoffStorageId, formatHandoffCode } from "./handoff";
import type { Canvas } from "./types";

const canvas: Canvas = {
  id: "board-1",
  author: "Ada",
  pages: [
    {
      id: "page-1",
      items: [{ id: "note-1", type: "note", text: "handoff payload" }],
    },
  ],
  createdAt: "2026-06-12T12:00:00.000Z",
};

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return calls;
}

describe("importFromUrl handoff branch", () => {
  test("derives the storage id from the code and decrypts the board", async () => {
    const pkg = await createHandoffPackage(canvas);
    const expectedId = await createHandoffStorageId(pkg.code);
    const calls = stubFetch(() =>
      Response.json({ ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt }),
    );

    const result = await importFromUrl(formatHandoffCode(pkg.code));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canvas.pages[0]?.items[0]).toMatchObject({ type: "note", text: "handoff payload" });
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(encodeURIComponent(expectedId));
    // The code is the secret: it must never reach the server, even in the URL.
    expect(calls[0]).not.toContain(pkg.code);
  });

  test("accepts a /h#c= handoff link", async () => {
    const pkg = await createHandoffPackage(canvas);
    stubFetch(() => Response.json({ ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt }));

    const result = await importFromUrl(`https://shareboard.test/h#c=${formatHandoffCode(pkg.code)}`);

    expect(result.ok).toBe(true);
  });

  test("maps a 404 (expired or already used) to handoff-gone", async () => {
    const pkg = await createHandoffPackage(canvas);
    stubFetch(() => Response.json({ error: "Handoff not found" }, { status: 404 }));

    const result = await importFromUrl(formatHandoffCode(pkg.code));

    expect(result).toEqual({ ok: false, error: "handoff-gone" });
  });

  test("returns handoff-gone when the served envelope can't be decrypted", async () => {
    const pkg = await createHandoffPackage(canvas);
    const wrong = await createHandoffPackage(canvas);
    // A wrong code derives a different storage id (a real server would 404), but
    // even if the envelope is served, the key won't derive and decrypt fails closed.
    stubFetch(() => Response.json({ ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt }));

    const result = await importFromUrl(formatHandoffCode(wrong.code));

    expect(result).toEqual({ ok: false, error: "handoff-gone" });
  });

  test("non-handoff input falls through without touching the handoff endpoint", async () => {
    const calls = stubFetch(() => Response.json({}));

    expect(await importFromUrl("not a real code or link")).toEqual({ ok: false, error: "invalid-input" });
    expect(calls).toHaveLength(0);
  });
});
