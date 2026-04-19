const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!;
const PUBLIC_URL = process.env.R2_PUBLIC_URL!;
const BUCKET = "shareboard";

function r2Url(key: string) {
  return `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`;
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
      Authorization: `Bearer ${API_TOKEN}`,
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 upload failed (${res.status}): ${text}`);
  }
  return getPublicUrl(key);
}

export async function getObjectText(key: string): Promise<string | null> {
  const res = await fetch(r2Url(key), {
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
    },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 read failed (${res.status}): ${text}`);
  }
  return res.text();
}

export async function deleteObject(key: string) {
  const res = await fetch(r2Url(key), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
    },
  });
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 delete failed (${res.status}): ${text}`);
  }
}

export function getPublicUrl(key: string): string {
  return `${PUBLIC_URL}/${key}`;
}

export function getObjectKeyFromPublicUrl(url: string): string | null {
  const prefix = `${PUBLIC_URL}/`;
  if (!url.startsWith(prefix)) return null;
  return decodeURIComponent(url.slice(prefix.length));
}
