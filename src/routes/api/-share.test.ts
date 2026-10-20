import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetServerEnv, useMemoryStorage, type MemoryBucket } from "@/test/memory-bucket";
import { defined, pngFile } from "@/test/fixtures";
import type { Board, ShareCreateResponse, ShareRequest, SharedImageItem } from "@/lib/types";
import { isSharedImageItem } from "@/lib/types";
import { resetRateLimitsForTesting } from "@/lib/server/rate-limit";
import { setServerEnvForTesting } from "@/lib/server/env";
import { handleShareCreate, handleShareDelete } from "./share";
import { handleManifestGet } from "./share.$id";
import { handleObjectGet } from "./objects";
import { handleUnlock } from "./share.unlock";
import { createOwnerSessionForTesting } from "@/lib/server/owner";

const ORIGIN = "http://local.test";
let bucket: MemoryBucket;
let ownerCookie = "";

beforeEach(async () => {
  bucket = useMemoryStorage();
  ownerCookie = await createOwnerSessionForTesting();
});

afterEach(() => {
  resetServerEnv();
});

function imagePayload(ids: string[]): ShareRequest {
  return {
    author: "Ada",
    pages: [
      {
        id: "page-1",
        items: ids.map((id) => ({ id, type: "image", mimeType: "image/png", size: 10 })),
        layouts: { lg: [], sm: [] },
      },
    ],
  };
}

function shareForm(payload: ShareRequest, files: Record<string, string>, replace?: ShareCreateResponse) {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  for (const [id, body] of Object.entries(files)) form.set(`image:${id}`, pngFile(`${id}.png`, body));
  if (replace) form.set("replaceId", replace.id);
  return form;
}

function post(form: FormData, cookie = ownerCookie) {
  return handleShareCreate(
    new Request(`${ORIGIN}/api/share`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie }, body: form }),
  );
}

async function created(form: FormData): Promise<ShareCreateResponse> {
  const response = await post(form);
  expect(response.status).toBe(200);
  return response.json();
}

async function manifest(id: string): Promise<Board> {
  const response = await handleManifestGet(new Request(`${ORIGIN}/api/share/${id}`), id);
  expect(response.status).toBe(200);
  return response.json();
}

function images(board: Board): SharedImageItem[] {
  return board.pages.flatMap((page) => page.items).filter(isSharedImageItem);
}

function deleteShare(id: string) {
  return handleShareDelete(
    new Request(`${ORIGIN}/api/share?id=${id}`, { method: "DELETE", headers: { Origin: ORIGIN, Cookie: ownerCookie } }),
  );
}

describe("public shares", () => {
  test("dedupes identical uploads, hides the token hash, and serves revalidating manifests", async () => {
    const share = await created(shareForm(imagePayload(["a", "b"]), { a: "same", b: "same" }));
    const response = await handleManifestGet(new Request(`${ORIGIN}/api/share/${share.id}`), share.id);
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    const etag = defined(response.headers.get("ETag"), "etag");
    const body = await response.text();
    expect(body).not.toContain("deleteTokenHash");

    const board: Board = JSON.parse(body);
    const [first, second] = images(board);
    expect(first?.objectKey).toBe(defined(second).objectKey);
    expect(first?.url).toBe(`/api/objects?key=${encodeURIComponent(defined(first).objectKey)}`);

    const conditional = await handleManifestGet(
      new Request(`${ORIGIN}/api/share/${share.id}`, { headers: { "If-None-Match": etag } }),
      share.id,
    );
    expect(conditional.status).toBe(304);
  });

  test("replacing keeps the delete token, reuses unchanged images, and removes stale objects", async () => {
    const share = await created(shareForm(imagePayload(["keep", "old"]), { keep: "keep", old: "old" }));
    const before = images(await manifest(share.id));
    const keptKey = defined(before.find((image) => image.id === "keep")).objectKey;
    const oldKey = defined(before.find((image) => image.id === "old")).objectKey;

    const replaced = await created(shareForm(imagePayload(["keep", "new"]), { new: "new" }, share));
    expect(replaced).toEqual(share);

    const after = images(await manifest(share.id));
    expect(after.find((image) => image.id === "keep")?.objectKey).toBe(keptKey);
    expect(bucket.objects.has(oldKey)).toBe(false);
    expect(bucket.objects.has(keptKey)).toBe(true);
    expect((await post(shareForm(imagePayload(["keep"]), {}, share))).status).toBe(200);
  });

  test("replacing a board that no longer exists is refused and leaves no uploaded objects behind", async () => {
    await created(shareForm(imagePayload(["a"]), { a: "a" }));
    const keysBefore = bucket.keys();
    const response = await post(shareForm(imagePayload(["b"]), { b: "b" }, { id: "abcdefghijklmnopqrstuv" }));
    expect(response.status).toBe(404);
    expect(bucket.keys()).toEqual(keysBefore);
  });

  test("concurrent replacements: the loser gets 409 and its uploads are rolled back", async () => {
    const share = await created(shareForm(imagePayload(["a"]), { a: "a" }));
    const manifestKey = `canvases/${share.id}.json`;
    let releaseFirst: () => void = () => undefined;
    let pausedOnce = false;
    bucket.beforePut = async (key) => {
      if (key !== manifestKey || pausedOnce) return;
      pausedOnce = true;
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    };

    const slow = post(shareForm(imagePayload(["slow"]), { slow: "slow" }, share));
    while (!pausedOnce) await Bun.sleep(1);
    const fast = await post(shareForm(imagePayload(["fast"]), { fast: "fast" }, share));
    expect(fast.status).toBe(200);
    releaseFirst();
    const lost = await slow;
    expect(lost.status).toBe(409);

    const board = await manifest(share.id);
    expect(images(board).map((image) => image.id)).toEqual(["fast"]);
    expect(bucket.keys(`images/${share.id}/`)).toEqual(images(board).map((image) => image.objectKey));
  });

  test("a failed upload rolls back earlier uploads and keeps the previous manifest", async () => {
    const share = await created(shareForm(imagePayload(["a"]), { a: "a" }));
    const keysBefore = bucket.keys();
    let imagePuts = 0;
    bucket.beforePut = (key) => {
      if (key.startsWith("images/") && ++imagePuts === 2) throw new Error("R2 unavailable");
    };
    const response = await post(shareForm(imagePayload(["b", "c"]), { b: "b", c: "c" }, share));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to share board" });
    expect(bucket.keys()).toEqual(keysBefore);
    expect(images(await manifest(share.id)).map((image) => image.id)).toEqual(["a"]);
  });

  test("images can only be reused from the board being replaced", async () => {
    const other = await created(shareForm(imagePayload(["foreign"]), { foreign: "x" }));
    const share = await created(shareForm(imagePayload(["a"]), { a: "a" }));
    const response = await post(shareForm(imagePayload(["foreign"]), {}, share));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Missing image upload for item foreign" });
    expect(images(await manifest(other.id))).toHaveLength(1);
  });

  test("a duplicated image can reuse an object the board already owns, but not another board's", async () => {
    const other = await created(shareForm(imagePayload(["foreign"]), { foreign: "x" }));
    const share = await created(shareForm(imagePayload(["a"]), { a: "a" }));
    const ownKey = defined(images(await manifest(share.id))[0]).objectKey;
    const foreignKey = defined(images(await manifest(other.id))[0]).objectKey;

    const duplicate = shareForm(imagePayload(["a", "a-copy"]), {}, share);
    duplicate.set("reuse:a-copy", ownKey);
    expect((await post(duplicate)).status).toBe(200);
    expect(images(await manifest(share.id)).map((image) => image.objectKey)).toEqual([ownKey, ownKey]);

    const stolen = shareForm(imagePayload(["a", "stolen"]), {}, share);
    stolen.set("reuse:stolen", foreignKey);
    expect((await post(stolen)).status).toBe(400);
  });

  test("rejects active or mislabeled image content", async () => {
    const form = new FormData();
    form.set("payload", JSON.stringify(imagePayload(["svg"])));
    form.set("image:svg", new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" }));
    const response = await post(form);
    expect(response.status).toBe(400);
    expect(bucket.keys()).toEqual([]);
  });

  test("rejects non-multipart and cross-origin creates", async () => {
    const json = await handleShareCreate(
      new Request(`${ORIGIN}/api/share`, {
        method: "POST",
        headers: { Origin: ORIGIN, "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(json.status).toBe(400);
    const crossOrigin = await handleShareCreate(
      new Request(`${ORIGIN}/api/share`, { method: "POST", headers: { Origin: "https://evil.test" }, body: new FormData() }),
    );
    expect(crossOrigin.status).toBe(403);
  });

  test("deleting removes the manifest and every object", async () => {
    const form = shareForm(imagePayload(["a"]), { a: "a" });
    form.set("preview", pngFile("preview.png"));
    const share = await created(form);
    expect(bucket.keys(`previews/${share.id}/`)).toHaveLength(1);

    expect((await deleteShare(share.id)).status).toBe(200);
    expect(bucket.keys()).toEqual([]);
    const gone = await handleManifestGet(new Request(`${ORIGIN}/api/share/${share.id}`), share.id);
    expect(gone.status).toBe(404);
  });
});

describe("object proxy", () => {
  test("serves share images with sandboxing headers and refuses private prefixes", async () => {
    const share = await created(shareForm(imagePayload(["a"]), { a: "a" }));
    const key = defined(images(await manifest(share.id))[0]).objectKey;
    const response = await handleObjectGet(new Request(`${ORIGIN}/api/objects?key=${encodeURIComponent(key)}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");

    for (const blocked of [
      `canvases/${share.id}.json`,
      "locked/abc.json",
      "intake/abcdefghijklmnop/0",
      "handoff/abc.json",
      "_shareboard/owner/account.json",
      "images/../canvases/x.json",
    ]) {
      const refused = await handleObjectGet(new Request(`${ORIGIN}/api/objects?key=${encodeURIComponent(blocked)}`));
      expect(refused.status).toBe(400);
    }
  });
});

function envelope(id: string, images: Array<{ id: string; size: number }> = []) {
  return {
    id,
    encrypted: true,
    v: 1,
    kdf: "PBKDF2-SHA-256",
    iterations: 100000,
    salt: "c2FsdHNhbHRzYWx0c2FsdA",
    iv: "aXZpdml2aXZpdml2",
    data: "Q0lQSEVSVEVYVA",
    images: images.map((image) => ({ id: image.id, pageId: "p1", iv: "aXZpdml2aXZpdml2", size: image.size })),
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

function lockedForm(id: string, pin: string, replace?: ShareCreateResponse) {
  const form = new FormData();
  form.set("pin", pin);
  form.set("encryptedPayload", JSON.stringify(envelope(id, [{ id: "img", size: 4 }])));
  form.set("encrypted-image:img", new File([new Uint8Array([1, 2, 3, 4])], "img.bin"));
  if (replace) form.set("replaceId", replace.id);
  return form;
}

function unlock(id: string, pin: string) {
  return handleUnlock(
    new Request(`${ORIGIN}/api/share/unlock`, {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ id, pin }),
    }),
  );
}

describe("locked shares", () => {
  const id = "LockedBoardId123456789";

  test("manifests only reveal a stub and unlock returns ciphertext without server secrets", async () => {
    await created(lockedForm(id, "123456"));
    const stub = await handleManifestGet(new Request(`${ORIGIN}/api/share/${id}`), id);
    expect(await stub.json()).toEqual({ id, encrypted: true, locked: true });

    const unlocked = await unlock(id, "123456");
    expect(unlocked.status).toBe(200);
    expect(unlocked.headers.get("Cache-Control")).toBe("no-store");
    const body = await unlocked.text();
    expect(body).toContain("Q0lQSEVSVEVYVA");
    expect(body).not.toContain("pinVerifier");
    expect(body).not.toContain("deleteTokenHash");
    expect(JSON.parse(body).images[0].url).toMatch(/^\/api\/objects\?key=locked-images%2F/);
  });

  test("an existing id cannot be claimed twice", async () => {
    await created(lockedForm(id, "123456"));
    expect((await post(lockedForm(id, "654321"))).status).toBe(409);
  });

  test("wrong PINs are counted globally and lock the board for the hour", async () => {
    await created(lockedForm(id, "123456"));
    for (let attempt = 0; attempt < 10; attempt += 1) {
      resetRateLimitsForTesting();
      expect((await unlock(id, "000000")).status).toBe(403);
    }
    resetRateLimitsForTesting();
    const lockedOut = await unlock(id, "123456");
    expect(lockedOut.status).toBe(429);
  });

  test("a burst of simultaneous guesses cannot exceed the hourly attempt cap", async () => {
    await created(lockedForm(id, "123456"));
    setServerEnvForTesting({
      SHAREBOARD_LOCKED_STORAGE_SECRET: "test-secret",
      SHAREBOARD_R2: bucket,
      SHAREBOARD_UNLOCK_RATE_LIMIT: { limit: async () => ({ success: true }) },
      SHAREBOARD_UNLOCK_BOARD_RATE_LIMIT: { limit: async () => ({ success: true }) },
    });
    const statuses = await Promise.all(Array.from({ length: 40 }, () => unlock(id, "000000").then((r) => r.status)));
    expect(statuses.filter((status) => status === 403).length).toBeLessThanOrEqual(10);
    expect(statuses.every((status) => status === 403 || status === 429)).toBe(true);
  });

  test("a correct PIN gives its attempt back, so viewers do not lock each other out", async () => {
    await created(lockedForm(id, "123456"));
    for (let view = 0; view < 15; view += 1) {
      resetRateLimitsForTesting();
      expect((await unlock(id, "123456")).status).toBe(200);
    }
  });

  test("a locked share cannot claim the id of an existing public share", async () => {
    const share = await created(shareForm(imagePayload(["a"]), { a: "a" }));
    resetRateLimitsForTesting();
    expect((await post(lockedForm(share.id, "123456"))).status).toBe(409);
  });

  test("replace rotates the PIN, keeps the token, and removes old ciphertext", async () => {
    const share = await created(lockedForm(id, "123456"));
    const oldImages = bucket.keys("locked-images/");
    expect(await created(lockedForm(id, "999999", share))).toEqual(share);
    expect(bucket.keys("locked-images/")).not.toEqual(oldImages);
    expect(bucket.keys("locked-images/")).toHaveLength(1);
    resetRateLimitsForTesting();
    expect((await unlock(id, "999999")).status).toBe(200);
  });

  test("delete removes the locked manifest and encrypted images", async () => {
    const share = await created(lockedForm(id, "123456"));
    expect((await deleteShare(share.id)).status).toBe(200);
    expect(bucket.keys().filter((key) => key.startsWith("locked"))).toEqual([]);
  });

  test("production builds refuse locked shares without a storage secret", async () => {
    const unsecured = useMemoryStorage({ SHAREBOARD_LOCKED_STORAGE_SECRET: "" });
    const response = await post(lockedForm(id, "123456"), await createOwnerSessionForTesting());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Locked share storage secret is not configured" });
    expect(unsecured.keys().filter((key) => !key.startsWith("_shareboard/owner/"))).toEqual([]);
  });
});
