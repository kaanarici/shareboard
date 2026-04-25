const BUCKET = "shareboard";

function env(name: "CLOUDFLARE_ACCOUNT_ID" | "CLOUDFLARE_API_TOKEN" | "R2_PUBLIC_URL") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Sharing storage is not configured");
  return value;
}

function publicBaseUrl() {
  return env("R2_PUBLIC_URL").replace(/\/+$/, "");
}

function r2Url(key: string) {
  const accountId = env("CLOUDFLARE_ACCOUNT_ID");
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
}

export async function putObject(key: string, body: string): Promise<string> {
  return putBuffer(key, body, "application/json");
}

export async function putBuffer(
  key: string,
  body: BodyInit,
  contentType: string,
  cacheControl = "no-store"
): Promise<string> {
  const res = await fetch(r2Url(key), {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}`,
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
  const res = await fetch(r2Url(key), {
    headers: {
      Authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}`,
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
  const res = await fetch(r2Url(key), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${env("CLOUDFLARE_API_TOKEN")}`,
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
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${publicBaseUrl()}/${path}`;
}

export function getObjectKeyFromPublicUrl(url: string): string | null {
  const prefix = `${publicBaseUrl()}/`;
  if (!url.startsWith(prefix)) return null;
  return url
    .slice(prefix.length)
    .split("/")
    .map((part) => decodeURIComponent(part))
    .join("/");
}
