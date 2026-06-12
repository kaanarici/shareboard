import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Canvas, ShareCreateResponse, SharedImageItem, ShareRequestPayload } from "../../lib/types";
import { Route } from "./share";

const STORAGE_ROOT = ".shareboard-storage";
const MANIFEST_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=3600";

let previousLocalStorage: string | undefined;

beforeEach(() => {
  previousLocalStorage = process.env.SHAREBOARD_LOCAL_STORAGE;
  process.env.SHAREBOARD_LOCAL_STORAGE = "1";
});

afterEach(async () => {
  if (previousLocalStorage === undefined) {
    delete process.env.SHAREBOARD_LOCAL_STORAGE;
  } else {
    process.env.SHAREBOARD_LOCAL_STORAGE = previousLocalStorage;
  }
  await rm(STORAGE_ROOT, { recursive: true, force: true });
});

function imagePayload(ids: string[]): ShareRequestPayload {
  return {
    author: "Ada",
    pages: [
      {
        id: "page-1",
        items: ids.map((id) => ({
          id,
          type: "image",
          mimeType: "image/png",
          size: 10,
        })),
      },
    ],
  };
}

function createShareForm(payload: ShareRequestPayload, files: Record<string, string>) {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  for (const [id, body] of Object.entries(files)) {
    form.set(`image:${id}`, new File([body], `${id}.png`, { type: "image/png" }));
  }
  return form;
}

async function postShare(form: FormData): Promise<ShareCreateResponse> {
  const handler = Route.options.server.handlers.POST;
  const response = await handler({
    request: new Request("http://local.test/api/share", {
      method: "POST",
      headers: { Origin: "http://local.test" },
      body: form,
    }),
  } as Parameters<typeof handler>[0]);
  expect(response.status).toBe(200);
  return (await response.json()) as ShareCreateResponse;
}

async function getManifestResponse(id: string, headers?: HeadersInit) {
  const handler = Route.options.server.handlers.GET;
  const key = encodeURIComponent(`canvases/${id}.json`);
  return handler({
    request: new Request(`http://local.test/api/share?key=${key}`, { headers }),
  } as Parameters<typeof handler>[0]);
}

async function getManifest(id: string): Promise<Canvas> {
  const response = await getManifestResponse(id);
  expect(response.status).toBe(200);
  return (await response.json()) as Canvas;
}

function images(canvas: Canvas): SharedImageItem[] {
  return canvas.pages
    .flatMap((page) => page.items)
    .filter((item): item is SharedImageItem => item.type === "image");
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function localObjectPath(key: string) {
  return join(process.cwd(), STORAGE_ROOT, ...key.split("/"));
}

describe("public share route storage behavior", () => {
  test("dedupes identical image uploads within one board and serves manifest validators", async () => {
    const created = await postShare(
      createShareForm(imagePayload(["img-1", "img-2"]), {
        "img-1": "same-bytes",
        "img-2": "same-bytes",
      }),
    );

    const response = await getManifestResponse(created.id);
    expect(response.headers.get("Cache-Control")).toBe(MANIFEST_CACHE_CONTROL);
    const etag = response.headers.get("ETag");
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);

    const manifest = (await response.json()) as Canvas;
    const storedImages = images(manifest);
    expect(storedImages).toHaveLength(2);
    expect(storedImages[0]?.objectKey).toBe(storedImages[1]?.objectKey);
    expect(storedImages[0]?.url).toBe(storedImages[1]?.url);

    const conditional = await getManifestResponse(created.id, { "If-None-Match": etag! });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("ETag")).toBe(etag);
    expect(conditional.headers.get("Cache-Control")).toBe(MANIFEST_CACHE_CONTROL);
  });

  test("replace cleanup removes stale objects when the replacement dedupes images", async () => {
    const created = await postShare(createShareForm(imagePayload(["old"]), { old: "old-bytes" }));
    const initialImage = images(await getManifest(created.id))[0];
    expect(initialImage?.objectKey).toBeTruthy();
    expect(await pathExists(localObjectPath(initialImage!.objectKey!))).toBe(true);

    const replacement = createShareForm(imagePayload(["new-1", "new-2"]), {
      "new-1": "same-new-bytes",
      "new-2": "same-new-bytes",
    });
    replacement.set("replaceId", created.id);
    replacement.set("replaceToken", created.deleteToken);

    const replaced = await postShare(replacement);
    expect(replaced.id).toBe(created.id);

    const replacedImages = images(await getManifest(created.id));
    expect(replacedImages).toHaveLength(2);
    expect(replacedImages[0]?.objectKey).toBe(replacedImages[1]?.objectKey);
    expect(replacedImages[0]?.objectKey).not.toBe(initialImage?.objectKey);
    expect(await pathExists(localObjectPath(initialImage!.objectKey!))).toBe(false);
    expect(await pathExists(localObjectPath(replacedImages[0]!.objectKey!))).toBe(true);
  });
});
