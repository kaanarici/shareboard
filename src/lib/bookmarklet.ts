import type { ShareParams } from "./share-intake";

// Bookmarklet capture payload. Single-letter keys keep the captured URL
// fragment short: t = page title, u = page url, x = selected text.
export type ClipPayload = { t?: string; u?: string; x?: string };

export const CLIP_HASH_PREFIX = "#clip=";

// Decode is defensive about length: a hand-edited hash could exceed the caps
// the bookmarklet applies at capture time, so every field is re-clamped here.
const FIELD_CAP = 4000;

// The capture rides the URL fragment (after #), never a query param, so the
// selected text never reaches the server, its access logs, or the referrer.
export function buildBookmarklet(origin: string): string {
  return `javascript:(()=>{const s=String(getSelection()||"");const p={t:document.title.slice(0,300),u:location.href.slice(0,2000),...(s?{x:s.slice(0,4000)}:{})};open("${origin}/#clip="+encodeURIComponent(JSON.stringify(p)),"_blank")})()`;
}

export function buildClipHash(payload: ClipPayload): string {
  return CLIP_HASH_PREFIX + encodeURIComponent(JSON.stringify(payload));
}

// Decode a `#clip=` fragment into share-intake params, or null when the hash is
// absent, malformed, or carries nothing usable.
export function parseClipHash(hash: string): ShareParams | null {
  if (!hash.startsWith(CLIP_HASH_PREFIX)) return null;
  const encoded = hash.slice(CLIP_HASH_PREFIX.length);
  if (!encoded) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(decodeURIComponent(encoded));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;

  const { t, u, x } = payload as ClipPayload;
  const clamp = (value: unknown) =>
    typeof value === "string" && value ? value.slice(0, FIELD_CAP) : undefined;

  const params: ShareParams = { title: clamp(t), url: clamp(u), text: clamp(x) };
  if (!params.title && !params.url && !params.text) return null;
  return params;
}
