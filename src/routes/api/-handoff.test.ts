import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { bytesToBase64Url } from "@/lib/crypto";
import { boardAsJson, sanitizeTextBoard } from "@/lib/canvas-sanitize";
import { resetRateLimitsForTesting } from "@/lib/server/rate-limit";
import { resetServerEnv, useMemoryStorage, type MemoryBucket } from "@/test/memory-bucket";
import { createOwnerSessionForTesting } from "@/lib/server/owner";
import { defined } from "@/test/fixtures";
import {
  createHandoffPackage,
  createHandoffStorageId,
  decryptHandoff,
  formatHandoffCode,
} from "@/lib/handoff";
import type { Board } from "@/lib/types";
import { HANDOFF_MAX_CIPHERTEXT_BYTES, handleHandoffCreate, handleHandoffRead, handoffKey } from "./handoff";


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

let bucket: MemoryBucket;
let ownerCookie = "";

beforeEach(async () => {
  bucket = useMemoryStorage();
  ownerCookie = await createOwnerSessionForTesting();
});

afterEach(() => {
  resetServerEnv();
});

type HandoffCreateBody = {
  storageId: string;
  ciphertext: string;
  iv: string;
  salt: string;
};

async function postHandoff(body: HandoffCreateBody, headers: HeadersInit = {}) {
  resetRateLimitsForTesting();
  return handleHandoffCreate(
    new Request("http://local.test/api/handoff", {
      method: "POST",
      headers: { Origin: "http://local.test", "Content-Type": "application/json", Cookie: ownerCookie, ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function getHandoff(storageId: string) {
  resetRateLimitsForTesting();
  return handleHandoffRead(new Request(`http://local.test/api/handoff?id=${encodeURIComponent(storageId)}`));
}

function handoffBody(pkg: Awaited<ReturnType<typeof createHandoffPackage>>) {
  return {
    storageId: pkg.storageId,
    ciphertext: pkg.ciphertext,
    iv: pkg.iv,
    salt: pkg.salt,
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
    const encrypted: { ciphertext: string; iv: string; salt: string } = await first.json();
    expect(encrypted).toEqual({ ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt });
    await expect(
      decryptHandoff(encrypted.ciphertext, pkg.code, encrypted.iv, encrypted.salt)
    ).resolves.toEqual(sanitizeTextBoard(boardAsJson(canvas)));

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
    const stored = defined(bucket.text(handoffKey(pkg.storageId)), "stored handoff");
    expect("code" in JSON.parse(stored)).toBe(false);
    for (const code of visibleCodes) expect(stored).not.toContain(code);
  });

  test("treats expired stored handoffs as absent", async () => {
    const pkg = await createHandoffPackage(canvas);
    const storageId = await createHandoffStorageId("K7QXM3PDW8RT");
    await bucket.put(
      handoffKey(storageId),
      JSON.stringify({ v: 1, ciphertext: pkg.ciphertext, iv: pkg.iv, salt: pkg.salt, expiresAt: Date.now() - 1 }),
    );

    const response = await getHandoff(storageId);
    expect(response.status).toBe(404);
    expect(bucket.objects.has(handoffKey(storageId))).toBe(false);
  });

  test("two simultaneous reads cannot both receive the ciphertext", async () => {
    const pkg = await createHandoffPackage(canvas);
    expect((await postHandoff(handoffBody(pkg))).status).toBe(201);
    const [first, second] = await Promise.all([getHandoff(pkg.storageId), getHandoff(pkg.storageId)]);
    expect([first.status, second.status].sort()).toEqual([200, 404]);
  });

  test("a consumed handoff id can be reused for a fresh handoff", async () => {
    const pkg = await createHandoffPackage(canvas);
    expect((await postHandoff(handoffBody(pkg))).status).toBe(201);
    expect((await getHandoff(pkg.storageId)).status).toBe(200);
    expect((await postHandoff(handoffBody(pkg))).status).toBe(201);
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
