import { getLocalShareObjectKey, isSafeObjectKey } from "@/lib/storage-keys";

export { isSafeObjectKey } from "@/lib/storage-keys";

const LOCAL_PUBLIC_PATH = "/api/share";
const LOCAL_STORAGE_DIR = ".shareboard-storage";

let cloudflareEnvPromise: Promise<Partial<Cloudflare.Env>> | undefined;

function getCloudflareEnv(): Promise<Partial<Cloudflare.Env>> {
  cloudflareEnvPromise ??= (async () => {
    try {
      return (await import(/* @vite-ignore */ "cloudflare:workers")).env ?? {};
    } catch {
      return {};
    }
  })();
  return cloudflareEnvPromise;
}

function canUseLocalStorage() {
  return typeof process !== "undefined" && process.env.SHAREBOARD_LOCAL_STORAGE !== "0";
}

function localObjectUrl(key: string) {
  return `${LOCAL_PUBLIC_PATH}?key=${encodeURIComponent(key)}`;
}

function localKeyFromUrl(url: string): string | null {
  return getLocalShareObjectKey(url);
}

function assertSafeKey(key: string) {
  if (!isSafeObjectKey(key)) {
    throw new Error("Invalid storage key");
  }
}

async function localPath(key: string) {
  assertSafeKey(key);
  const path = await import("node:path");
  return path.join(process.cwd(), LOCAL_STORAGE_DIR, key);
}

type StorageBody = string | ArrayBuffer | ArrayBufferView;

async function localPut(key: string, body: StorageBody, contentType: string) {
  const fs = await import("node:fs/promises");
  const file = await localPath(key);
  await fs.mkdir((await import("node:path")).dirname(file), { recursive: true });
  const bytes =
    typeof body === "string"
      ? Buffer.from(body)
      : body instanceof ArrayBuffer
        ? Buffer.from(body)
        : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  await fs.writeFile(file, bytes);
  await fs.writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
  return localObjectUrl(key);
}

async function localGet(key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  const fs = await import("node:fs/promises");
  const file = await localPath(key);
  try {
    const [bytes, metaRaw] = await Promise.all([
      fs.readFile(file),
      fs.readFile(`${file}.meta.json`, "utf8").catch(() => "{}"),
    ]);
    const meta = JSON.parse(metaRaw) as { contentType?: string };
    return { bytes, contentType: meta.contentType || "application/octet-stream" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function localDelete(key: string) {
  const fs = await import("node:fs/promises");
  const file = await localPath(key);
  await Promise.all([
    fs.rm(file, { force: true }),
    fs.rm(`${file}.meta.json`, { force: true }),
  ]);
}

function publicUrl(baseUrl: string, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

async function publicBaseUrl(): Promise<string | null> {
  const cfEnv = await getCloudflareEnv();
  const value = String(cfEnv.R2_PUBLIC_URL ?? process.env.R2_PUBLIC_URL ?? "").trim();
  return value ? value.replace(/\/+$/, "") : null;
}

async function bucket() {
  return (await getCloudflareEnv()).SHAREBOARD_R2;
}

export async function putObject(
  key: string,
  body: string,
  cacheControl?: string,
): Promise<string> {
  return putBuffer(key, body, "application/json", cacheControl);
}

export async function putBuffer(
  key: string,
  body: StorageBody,
  contentType: string,
  cacheControl = "no-store",
): Promise<string> {
  assertSafeKey(key);
  const boundBucket = await bucket();
  if (boundBucket) {
    await boundBucket.put(key, body, {
      httpMetadata: { contentType, cacheControl },
    });
    const baseUrl = await publicBaseUrl();
    return baseUrl ? publicUrl(baseUrl, key) : localObjectUrl(key);
  }

  if (canUseLocalStorage()) {
    return localPut(key, body, contentType);
  }

  throw new Error("Sharing storage is not configured");
}

export async function getObjectText(key: string): Promise<string | null> {
  assertSafeKey(key);
  const boundBucket = await bucket();
  if (boundBucket) {
    const object = await boundBucket.get(key);
    return object ? object.text() : null;
  }

  if (canUseLocalStorage()) {
    const object = await localGet(key);
    return object ? object.bytes.toString("utf8") : null;
  }

  throw new Error("Sharing storage is not configured");
}

export async function deleteObject(key: string) {
  assertSafeKey(key);
  const boundBucket = await bucket();
  if (boundBucket) {
    await boundBucket.delete(key);
    return;
  }

  if (canUseLocalStorage()) {
    await localDelete(key);
    return;
  }

  throw new Error("Sharing storage is not configured");
}

export async function getObjectKeyFromPublicUrlAsync(url: string): Promise<string | null> {
  const localKey = localKeyFromUrl(url);
  if (localKey) return isSafeObjectKey(localKey) ? localKey : null;
  const baseUrl = await publicBaseUrl();
  if (!baseUrl) return null;
  const prefix = `${baseUrl}/`;
  if (!url.startsWith(prefix)) return null;
  const key = url
    .slice(prefix.length)
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/");
  return isSafeObjectKey(key) ? key : null;
}

export async function getObjectResponse(key: string): Promise<Response | null> {
  assertSafeKey(key);
  const boundBucket = await bucket();
  if (boundBucket) {
    const object = await boundBucket.get(key);
    if (!object) return null;
    return new Response(await object.arrayBuffer(), {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (canUseLocalStorage()) {
    const object = await localGet(key);
    if (!object) return null;
    return new Response(new Uint8Array(object.bytes), {
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  return null;
}
