import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import { bytesToBase64Url } from "@/lib/base64url";
import { sanitizePublicCanvasManifest } from "@/lib/canvas-sanitize";
import {
  createHandoffPackage,
  createHandoffStorageId,
  decryptHandoff,
  formatHandoffCode,
} from "@/lib/handoff";
import { putBuffer } from "@/lib/r2";
import { resetRateLimitForTesting } from "@/lib/rate-limit";
import type { Canvas } from "@/lib/types";
import { HANDOFF_MAX_CIPHERTEXT_BYTES, Route } from "./handoff";

const STORAGE_ROOT = ".shareboard-storage";

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

let previousLocalStorage: string | undefined;

beforeEach(() => {
  previousLocalStorage = process.env.SHAREBOARD_LOCAL_STORAGE;
  process.env.SHAREBOARD_LOCAL_STORAGE = "1";
  resetRateLimitForTesting();
});

afterEach(async () => {
  if (previousLocalStorage === undefined) {
    delete process.env.SHAREBOARD_LOCAL_STORAGE;
  } else {
    process.env.SHAREBOARD_LOCAL_STORAGE = previousLocalStorage;
  }
  resetRateLimitForTesting();
  await rm(STORAGE_ROOT, { recursive: true, force: true });
});

async function postHandoff(body: unknown, headers: HeadersInit = {}) {
  const handler = Route.options.server.handlers.POST;
  return handler({
    request: new Request("http://local.test/api/handoff", {
      method: "POST",
      headers: { Origin: "http://local.test", "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  } as Parameters<typeof handler>[0]);
}

async function getHandoff(storageId: string) {
  const handler = Route.options.server.handlers.GET;
  return handler({
    request: new Request(`http://local.test/api/handoff?id=${encodeURIComponent(storageId)}`),
  } as Parameters<typeof handler>[0]);
}

function handoffBody(pkg: Awaited<ReturnType<typeof createHandoffPackage>>) {
  return {
    storageId: pkg.storageId,
    ciphertext: pkg.ciphertext,
    iv: pkg.iv,
    salt: pkg.salt,
    expiresInMs: 60_000,
  };
}

describe("handoff route", () => {
  test("stores ciphertext, serves it once, and decrypts with the typed code", async () => {
    const pkg = await createHandoffPackage(canvas);
    const created = await postHandoff(handoffBody(pkg));
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toEqual({});

    const first = await getHandoff(pkg.storageId);
    expect(first.status).toBe(200);
    expect(first.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(first.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    const encrypted = (await first.json()) as { ciphertext: string; iv: string; salt: string };
    expect(encrypted).toEqual({ ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt });
    await expect(
      decryptHandoff(encrypted.ciphertext, pkg.code, encrypted.iv, encrypted.salt)
    ).resolves.toEqual(sanitizePublicCanvasManifest(canvas, { allowBoardSummary: true }));

    const second = await getHandoff(pkg.storageId);
    expect(second.status).toBe(404);
  });

  test("rejects an unexpired duplicate storage id", async () => {
    const pkg = await createHandoffPackage(canvas);
    const body = handoffBody(pkg);

    expect((await postHandoff(body)).status).toBe(201);
    expect((await postHandoff(body)).status).toBe(409);
  });

  test("keeps the code out of the posted and stored payloads", async () => {
    const pkg = await createHandoffPackage(canvas);
    const body = handoffBody(pkg);
    const visibleCodes = [pkg.code, pkg.code.toLowerCase(), formatHandoffCode(pkg.code)];

    const posted = JSON.stringify(body);
    expect("code" in body).toBe(false);
    for (const code of visibleCodes) expect(posted).not.toContain(code);

    expect((await postHandoff(body)).status).toBe(201);
    const stored = await readFile(`${STORAGE_ROOT}/handoff/${pkg.storageId}.json`, "utf8");
    const storedObject = JSON.parse(stored) as Record<string, unknown>;
    expect("code" in storedObject).toBe(false);
    for (const code of visibleCodes) expect(stored).not.toContain(code);
  });

  test("treats expired stored handoffs as absent", async () => {
    const pkg = await createHandoffPackage(canvas);
    const storageId = await createHandoffStorageId("K7QXM3PDW8RT");
    await putBuffer(
      `handoff/${storageId}.json`,
      JSON.stringify({
        v: 1,
        ciphertext: pkg.ciphertext,
        iv: pkg.iv,
        salt: pkg.salt,
        expiresAt: Date.now() - 1,
      }),
      "application/json",
      "no-store"
    );

    const response = await getHandoff(storageId);
    expect(response.status).toBe(404);
  });

  test("rejects oversized ciphertext", async () => {
    const pkg = await createHandoffPackage(canvas);
    const oversized = bytesToBase64Url(new Uint8Array(HANDOFF_MAX_CIPHERTEXT_BYTES + 1));

    const response = await postHandoff({
      ...handoffBody(pkg),
      ciphertext: oversized,
    });
    expect(response.status).toBe(413);
  });

  test("enforces same-origin creates", async () => {
    const pkg = await createHandoffPackage(canvas);
    const response = await postHandoff(
      handoffBody(pkg),
      { Origin: "https://evil.test" }
    );

    expect(response.status).toBe(403);
  });
});
