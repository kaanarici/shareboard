import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetRateLimitsForTesting } from "@/lib/server/rate-limit";
import { intakeManifestKey, storeIntakeFiles } from "@/lib/server/share-intake";
import { resetServerEnv, useMemoryStorage, type MemoryBucket } from "@/test/memory-bucket";
import { defined, pngFile } from "@/test/fixtures";
import { handleIntakeDelete, handleIntakeGet } from "./intake.$id";
import { handleObjectGet } from "./objects";
import { handleShareTargetPost } from "../share-target";
import { createOwnerSessionForTesting } from "@/lib/server/owner";

const INTAKE_ID = "abcdefghijklmnopqrstuvwx";
let bucket: MemoryBucket;
let ownerCookie = "";

beforeEach(async () => {
  bucket = useMemoryStorage();
  ownerCookie = await createOwnerSessionForTesting();
});

afterEach(() => {
  resetServerEnv();
});

function getIntake(id = INTAKE_ID, cookie = `shareboard_intake=${id}`) {
  resetRateLimitsForTesting();
  return handleIntakeGet(new Request(`http://local.test/api/intake/${id}`, { headers: { Cookie: cookie } }), id);
}

describe("intake stash", () => {
  test("GET returns verified images once and then deletes every object", async () => {
    await storeIntakeFiles(INTAKE_ID, [pngFile("shot.png"), new File(["<svg/>"], "x.svg", { type: "image/svg+xml" })]);
    const response = await getIntake();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const files = (await response.formData()).getAll("media").filter((value) => value instanceof File);
    expect(files.map((file) => file.name)).toEqual(["shot.png"]);
    expect((await defined(files[0]).text()).endsWith("png-bytes")).toBe(true);
    expect(bucket.keys("intake/")).toEqual([]);
    expect((await getIntake()).status).toBe(404);
  });

  test("expired stashes are not served but are still cleaned up", async () => {
    const manifest = await storeIntakeFiles(INTAKE_ID, [pngFile("shot.png")]);
    await bucket.put(intakeManifestKey(INTAKE_ID), JSON.stringify({ ...manifest, expiresAt: Date.now() - 1 }));
    expect((await getIntake()).status).toBe(404);
    expect(bucket.keys("intake/")).toEqual([]);
  });

  test("DELETE removes a live stash and rejects cross-origin callers", async () => {
    await storeIntakeFiles(INTAKE_ID, [pngFile("shot.png")]);
    const crossOrigin = await handleIntakeDelete(
      new Request(`http://local.test/api/intake/${INTAKE_ID}`, { method: "DELETE", headers: { Origin: "https://evil.test" } }),
      INTAKE_ID,
    );
    expect(crossOrigin.status).toBe(403);
    await handleIntakeDelete(
      new Request(`http://local.test/api/intake/${INTAKE_ID}`, {
        method: "DELETE",
        headers: { Cookie: `shareboard_intake=${INTAKE_ID}` },
      }),
      INTAKE_ID,
    );
    expect(bucket.keys("intake/")).toEqual([]);
  });

  test("stash ids are validated and stash objects are not public", async () => {
    expect((await getIntake("intake/../canvases")).status).toBe(404);
    const manifest = await storeIntakeFiles(INTAKE_ID, [pngFile("shot.png")]);
    const key = defined(manifest.files[0]).key;
    const response = await handleObjectGet(new Request(`http://local.test/api/objects?key=${encodeURIComponent(key)}`));
    expect(response.status).toBe(400);
  });

  test("the share-target POST stashes files and redirects home with the text fields", async () => {
    const form = new FormData();
    form.set("title", "Shared title");
    form.append("media", pngFile("one.png"));
    const response = await handleShareTargetPost(
      new Request("http://local.test/share-target", { method: "POST", body: form, headers: { Cookie: ownerCookie } }),
    );
    expect(response.status).toBe(303);
    const location = new URL(defined(response.headers.get("Location")), "http://local.test");
    expect(location.searchParams.get("title")).toBe("Shared title");
    const intake = defined(location.searchParams.get("intake"));
    expect(response.headers.get("Set-Cookie")).toContain(`shareboard_intake=${intake}; Path=/api/intake`);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect((await getIntake(intake, "")).status).toBe(404);
    expect((await getIntake(intake, "shareboard_intake=someone-else")).status).toBe(404);
    expect((await getIntake(intake)).status).toBe(200);
  });

  test("cross-site share-target posts keep their text but never stash files", async () => {
    const form = new FormData();
    form.set("text", "hello");
    form.append("media", pngFile("one.png"));
    const response = await handleShareTargetPost(
      new Request("http://local.test/share-target", {
        method: "POST",
        body: form,
        headers: { "Sec-Fetch-Site": "cross-site", Cookie: ownerCookie },
      }),
    );
    const location = new URL(defined(response.headers.get("Location")), "http://local.test");
    expect(location.searchParams.get("intake")).toBeNull();
    expect(location.searchParams.get("text")).toBe("hello");
    expect(bucket.keys("intake/")).toEqual([]);
  });

  test("two simultaneous reads cannot both receive the files", async () => {
    await storeIntakeFiles(INTAKE_ID, [pngFile("shot.png")]);
    const [first, second] = await Promise.all([getIntake(), getIntake()]);
    expect([first.status, second.status].sort()).toEqual([200, 404]);
  });
});
