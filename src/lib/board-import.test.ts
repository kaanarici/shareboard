import { afterEach, describe, expect, test } from "bun:test";
import { importBoard, unlockBoard } from "./share-import";
import { createHandoffPackage, createHandoffStorageId, formatHandoffCode } from "./handoff";
import { createLockedSharePackage } from "./encrypted-share";
import type { Board } from "./types";

const canvas: Board = {
  id: "board-1",
  author: "Ada",
  pages: [
    {
      id: "page-1",
      layouts: { lg: [], sm: [] },
      items: [{ id: "note-1", type: "note", html: "handoff payload" }],
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
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      return handler(url);
    },
    { preconnect: realFetch.preconnect },
  );
  return calls;
}

describe("importBoard handoff branch", () => {
  test("derives the storage id from the code and decrypts the board", async () => {
    const pkg = await createHandoffPackage(canvas);
    const expectedId = await createHandoffStorageId(pkg.code);
    const calls = stubFetch(() =>
      Response.json({ ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt }),
    );

    const result = await importBoard(formatHandoffCode(pkg.code));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canvas.pages[0]?.items[0]).toMatchObject({ type: "note", html: "handoff payload" });
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(encodeURIComponent(expectedId));
    expect(calls[0]).not.toContain(pkg.code);
  });

  test("accepts a /h#c= handoff link", async () => {
    const pkg = await createHandoffPackage(canvas);
    stubFetch(() => Response.json({ ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt }));

    const result = await importBoard(`https://shareboard.test/h#c=${formatHandoffCode(pkg.code)}`);

    expect(result.ok).toBe(true);
  });

  test("maps a 404 (expired or already used) to handoff-gone", async () => {
    const pkg = await createHandoffPackage(canvas);
    stubFetch(() => Response.json({ error: "Handoff not found" }, { status: 404 }));

    const result = await importBoard(formatHandoffCode(pkg.code));

    expect(result).toEqual({ ok: false, error: "handoff-gone" });
  });

  test("returns handoff-gone when the served envelope can't be decrypted", async () => {
    const pkg = await createHandoffPackage(canvas);
    const wrong = await createHandoffPackage(canvas);
    stubFetch(() => Response.json({ ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt }));

    const result = await importBoard(formatHandoffCode(wrong.code));

    expect(result).toEqual({ ok: false, error: "handoff-gone" });
  });

  test("non-handoff input falls through without touching the handoff endpoint", async () => {
    const calls = stubFetch(() => Response.json({}));

    expect(await importBoard("not a real code or link")).toEqual({ ok: false, error: "invalid-input" });
    expect(calls).toHaveLength(0);
  });
});

describe("unlockBoard", () => {
  test("posts the pin to /api/share/unlock and decrypts the envelope", async () => {
    const pkg = await createLockedSharePackage("123456", { ...canvas, id: "LockedBoardId123456789" }, []);
    const bodies: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        expect(url).toBe("/api/share/unlock");
        expect(init?.method).toBe("POST");
        bodies.push(String(init?.body));
        return Response.json(pkg.envelope);
      },
      { preconnect: realFetch.preconnect },
    );

    const result = await unlockBoard("board-1", "123456");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canvas.pages[0]?.items[0]).toMatchObject({ type: "note", html: "handoff payload" });
    }
    expect(bodies).toEqual([JSON.stringify({ id: "board-1", pin: "123456" })]);
  });

  test("maps a rejected pin to wrong-pin", async () => {
    stubFetch(() => new Response(null, { status: 403 }));
    expect(await unlockBoard("board-1", "000000")).toEqual({ ok: false, error: "wrong-pin" });
  });

  test("keeps throttling and undecryptable envelopes distinct from a wrong pin", async () => {
    stubFetch(() => new Response(null, { status: 429 }));
    expect(await unlockBoard("board-1", "123456")).toEqual({ ok: false, error: "fetch-failed" });
    const pkg = await createLockedSharePackage("654321", { ...canvas, id: "LockedBoardId123456789" }, []);
    stubFetch(() => Response.json(pkg.envelope));
    expect(await unlockBoard("board-1", "123456")).toEqual({ ok: false, error: "unreadable" });
  });
});
