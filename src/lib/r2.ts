const BUCKET = "shareboard";

type R2ObjectBody = {
  text(): Promise<string>;
};

type R2BucketBinding = {
  put(
    key: string,
    body: BodyInit,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
};

type CloudflareEnv = {
  SHAREBOARD_R2?: R2BucketBinding;
  R2_PUBLIC_URL?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
};

let cloudflareEnvPromise: Promise<CloudflareEnv> | undefined;

function getCloudflareEnv(): Promise<CloudflareEnv> {
  cloudflareEnvPromise ??= (async () => {
    try {
      return (await import(/* @vite-ignore */ "cloudflare:workers")).env ?? {};
    } catch {
      return {};
    }
  })();
  return cloudflareEnvPromise;
}

async function env(name: "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_API_TOKEN" | "R2_PUBLIC_URL") {
  const cfEnv = await getCloudflareEnv();
  const value = String(cfEnv[name] ?? process.env[name] ?? "").trim();
  if (!value) throw new Error("Sharing storage is not configured");
  return value;
}

function publicUrl(baseUrl: string, key: string): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

async function publicBaseUrl() {
  return (await env("R2_PUBLIC_URL")).replace(/\/+$/, "");
}

async function r2Url(key: string) {
  const accountId = await env("CLOUDFLARE_ACCOUNT_ID");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
}

async function bucket() {
  return (await getCloudflareEnv()).SHAREBOARD_R2;
}

export async function putObject(
  key: string,
  body: string,
  cacheControl?: string
): Promise<string> {
  return putBuffer(key, body, "application/json", cacheControl);
}

export async function putBuffer(
  key: string,
  body: BodyInit,
  contentType: string,
  cacheControl = "no-store"
): Promise<string> {
  const boundBucket = await bucket();
  if (boundBucket) {
    const baseUrl = await publicBaseUrl();
    await boundBucket.put(key, body, {
      httpMetadata: {
        contentType,
        cacheControl,
      },
    });
    return publicUrl(baseUrl, key);
  }

  const res = await fetch(await r2Url(key), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${await env("CLOUDFLARE_API_TOKEN")}`,
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`R2 upload failed (${res.status}): ${text}`);
    throw new Error("Sharing storage rejected the upload");
  }
  return getPublicUrl(key);
}

export async function getObjectText(key: string): Promise<string | null> {
  const boundBucket = await bucket();
  if (boundBucket) {
    const object = await boundBucket.get(key);
    return object ? object.text() : null;
  }

  const res = await fetch(await r2Url(key), {
    headers: {
      Authorization: `Bearer ${await env("CLOUDFLARE_API_TOKEN")}`,
    },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    console.error(`R2 read failed (${res.status}): ${text}`);
    throw new Error("Sharing storage could not read the board");
  }
  return res.text();
}

export async function deleteObject(key: string) {
  const boundBucket = await bucket();
  if (boundBucket) {
    await boundBucket.delete(key);
    return;
  }

  const res = await fetch(await r2Url(key), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${await env("CLOUDFLARE_API_TOKEN")}`,
    },
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await res.text();
    console.error(`R2 delete failed (${res.status}): ${text}`);
    throw new Error("Sharing storage could not delete the board");
  }
}

export function getPublicUrl(key: string): string {
  const value = process.env.R2_PUBLIC_URL?.trim();
  if (!value) throw new Error("Sharing storage is not configured");
  return publicUrl(value, key);
}

export async function getPublicUrlAsync(key: string): Promise<string> {
  return publicUrl(await publicBaseUrl(), key);
}

function objectKeyFromPublicUrl(url: string, baseUrl: string): string | null {
  const prefix = `${baseUrl.replace(/\/+$/, "")}/`;
  if (!url.startsWith(prefix)) return null;
  return url
    .slice(prefix.length)
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/");
}

export function getObjectKeyFromPublicUrl(url: string): string | null {
  const value = process.env.R2_PUBLIC_URL?.trim();
  return value ? objectKeyFromPublicUrl(url, value) : null;
}

export async function getObjectKeyFromPublicUrlAsync(url: string): Promise<string | null> {
  try {
    return objectKeyFromPublicUrl(url, await publicBaseUrl());
  } catch {
    return getObjectKeyFromPublicUrl(url);
  }
}
