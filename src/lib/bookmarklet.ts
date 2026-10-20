import { isRecord, parseJson, readString } from "@/lib/json";
import type { ShareParams } from "./intake";

export const CLIP_HASH_PREFIX = "#clip=";

const FIELD_CAP = 4000;

export function buildBookmarklet(origin: string): string {
  return `javascript:(()=>{const s=String(getSelection()||"");const p={t:document.title.slice(0,300),u:location.href.slice(0,2000),...(s?{x:s.slice(0,4000)}:{})};open("${origin}/#clip="+encodeURIComponent(JSON.stringify(p)),"_blank")})()`;
}

export function parseClipHash(hash: string): ShareParams | null {
  if (!hash.startsWith(CLIP_HASH_PREFIX)) return null;
  const encoded = hash.slice(CLIP_HASH_PREFIX.length);
  if (!encoded) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  const payload = parseJson(decoded);
  if (!isRecord(payload)) return null;

  const clamp = (value: unknown) => {
    const text = readString(value);
    return text ? text.slice(0, FIELD_CAP) : undefined;
  };

  const params: ShareParams = { title: clamp(payload.t), url: clamp(payload.u), text: clamp(payload.x) };
  if (!params.title && !params.url && !params.text) return null;
  return params;
}
