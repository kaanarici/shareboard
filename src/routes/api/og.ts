import { createFileRoute } from "@tanstack/react-router";
import { rateLimitResponse } from "@/lib/server/rate-limit";
import { BROWSER_UA, fetchPublicUrl } from "@/lib/server/safe-fetch";
import { clientIp } from "@/lib/server/request";
import { jsonResponse } from "@/lib/server/http";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const HEAD_CLOSE = "</head>";

async function readHeadHtml(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buffer = "";
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      const headEnd = buffer.toLowerCase().indexOf(HEAD_CLOSE);
      if (headEnd !== -1) {
        return buffer.slice(0, headEnd + HEAD_CLOSE.length);
      }
      if (total > MAX_HTML_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return buffer;
}

function resolveAbsolute(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const resolved = new URL(value, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

const NAMED_ENTITIES: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: "\u00a0" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#")) {
      const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number(lower.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[lower] ?? entity;
  });
}

function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([a-z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
      const [, name = "", double, single, bare] = match;
      attrs.set(name.toLowerCase(), double ?? single ?? bare ?? "");
    }
    const key = (attrs.get("property") ?? attrs.get("name"))?.toLowerCase();
    const content = attrs.get("content")?.trim();
    if (key && content && !tags.has(key)) tags.set(key, decodeEntities(content));
  }
  return tags;
}

export function parseOgHtml(html: string, pageUrl: string) {
  const tags = metaTags(html);
  const first = (...keys: string[]) => keys.map((key) => tags.get(key)).find(Boolean);
  const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();

  return {
    title: first("og:title", "twitter:title") || (titleTag ? decodeEntities(titleTag) : undefined),
    description: first("og:description", "twitter:description", "description"),
    image: resolveAbsolute(first("og:image", "og:image:url", "twitter:image"), pageUrl),
    siteName: first("og:site_name"),
    author: first("article:author", "author"),
  };
}

function emptyMetadata() {
  return jsonResponse({}, {}, "public, max-age=3600, stale-while-revalidate=86400");
}

export async function handleOgGet(request: Request): Promise<Response> {
  const limited = await rateLimitResponse("og", clientIp(request), "Too many metadata requests. Try again shortly.");
  if (limited) return limited;
  const rawUrl = new URL(request.url).searchParams.get("url");
  if (!rawUrl) return jsonResponse({ error: "Missing url parameter" }, { status: 400 });

  try {
    const { response, url } = await fetchPublicUrl(rawUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel().catch(() => undefined);
      return emptyMetadata();
    }
    return jsonResponse(
      parseOgHtml(await readHeadHtml(response), url),
      {},
      "public, max-age=86400, stale-while-revalidate=604800",
    );
  } catch {
    return emptyMetadata();
  }
}

export const Route = createFileRoute("/api/og")({
  server: {
    handlers: {
      GET: ({ request }) => handleOgGet(request),
    },
  },
});
