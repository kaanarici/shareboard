import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupOptions } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

type ResolvedPublicUrl = {
  url: URL;
  address: string;
  family: 4 | 6;
};

function isPrivateIp(address: string): boolean {
  if (address === "::1" || address === "0.0.0.0") return true;
  if (address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  if (address.startsWith("::ffff:")) return isPrivateIp(address.slice("::ffff:".length));
  if (address.includes(":")) return false;

  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) return true;

  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

async function assertPublicUrl(value: string): Promise<ResolvedPublicUrl> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URLs are allowed");
  if (url.username || url.password) throw new Error("Authenticated URLs are not allowed");
  if (["localhost", "localhost.localdomain"].includes(url.hostname) || url.hostname.endsWith(".local")) {
    throw new Error("Private hosts are not allowed");
  }

  const literal = isIP(url.hostname) ? url.hostname : null;
  if (literal && isPrivateIp(literal)) {
    throw new Error("Private hosts are not allowed");
  }

  if (literal) {
    return { url, address: literal, family: literal.includes(":") ? 6 : 4 };
  }

  const records = await lookup(url.hostname, { all: true });
  if (records.length === 0 || records.some((record) => isPrivateIp(record.address))) {
    throw new Error("Private hosts are not allowed");
  }

  const [selected] = records;
  if (!selected) {
    throw new Error("Host could not be resolved");
  }

  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

type PublicFetchResult = {
  response: Response;
  url: string;
};

function requestPinnedUrl(target: ResolvedPublicUrl, init: RequestInit): Promise<Response> {
  if (init.body) {
    throw new Error("Pinned fetch does not support request bodies");
  }

  const lookup: LookupFunction = (_hostname: string, options: LookupOptions, callback) => {
    if (options.all) {
      callback(null, [{ address: target.address, family: target.family } satisfies LookupAddress]);
      return;
    }
    callback(null, target.address, target.family);
  };

  return new Promise((resolve, reject) => {
    const isHttps = target.url.protocol === "https:";
    const headers = new Headers(init.headers);
    if (!headers.has("host")) headers.set("host", target.url.host);
    const requestOptions = {
      protocol: target.url.protocol,
      hostname: target.url.hostname,
      port: target.url.port || undefined,
      path: `${target.url.pathname}${target.url.search}`,
      method: init.method ?? "GET",
      headers: Object.fromEntries(headers.entries()),
      lookup,
      ...(isHttps ? { servername: target.url.hostname } : {}),
    };

    const req = (isHttps ? httpsRequest : httpRequest)(
      requestOptions,
      (res) => {
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) {
            responseHeaders.set(key, value.join(", "));
          } else if (value !== undefined) {
            responseHeaders.set(key, value);
          }
        }

        const status = res.statusCode ?? 502;
        const body =
          status === 204 || status === 304
            ? null
            : (Readable.toWeb(res) as ReadableStream<Uint8Array>);

        resolve(
          new Response(body, {
            status,
            statusText: res.statusMessage ?? "",
            headers: responseHeaders,
          })
        );
      }
    );

    req.on("error", reject);

    const onAbort = () => {
      req.destroy(
        init.signal?.reason instanceof Error ? init.signal.reason : new Error("Request aborted")
      );
    };

    if (init.signal) {
      if (init.signal.aborted) {
        onAbort();
        return;
      }
      init.signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => init.signal?.removeEventListener("abort", onAbort));
    }

    req.end();
  });
}

export async function fetchPublicUrl(
  value: string | URL,
  init: RequestInit = {},
  maxRedirects = 3
): Promise<PublicFetchResult> {
  let current = await assertPublicUrl(value.toString());

  for (let redirects = 0; ; redirects++) {
    const response = await requestPinnedUrl(current, init);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, url: current.url.toString() };
    }

    if (redirects >= maxRedirects) throw new Error("Too many redirects");

    const location = response.headers.get("location");
    if (!location) throw new Error("Redirect missing location");
    current = await assertPublicUrl(new URL(location, current.url).toString());
  }
}
