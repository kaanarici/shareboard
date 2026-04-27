import { isIP } from "node:net";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class PublicFetchError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "PublicFetchError";
  }
}

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

async function assertPublicUrl(value: string): Promise<URL> {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new PublicFetchError("Only http(s) URLs are allowed", 400);
  }
  if (url.username || url.password) {
    throw new PublicFetchError("Authenticated URLs are not allowed", 400);
  }
  if (["localhost", "localhost.localdomain"].includes(url.hostname) || url.hostname.endsWith(".local")) {
    throw new PublicFetchError("Private hosts are not allowed", 400);
  }

  const literal = isIP(url.hostname) ? url.hostname : null;
  if (literal && isPrivateIp(literal)) {
    throw new PublicFetchError("Private hosts are not allowed", 400);
  }

  return url;
}

type PublicFetchResult = {
  response: Response;
  url: string;
};

function requestPublicUrl(url: URL, init: RequestInit): Promise<Response> {
  if (init.body) {
    throw new PublicFetchError("Public URL fetch does not support request bodies", 400);
  }
  return fetch(url, {
    ...init,
    redirect: "manual",
  });
}

export async function fetchPublicUrl(
  value: string | URL,
  init: RequestInit = {},
  maxRedirects = 3
): Promise<PublicFetchResult> {
  let current = await assertPublicUrl(value.toString());

  for (let redirects = 0; ; redirects++) {
    const response = await requestPublicUrl(current, init);
    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, url: current.toString() };
    }

    if (redirects >= maxRedirects) {
      throw new PublicFetchError("Too many redirects", 502);
    }

    const location = response.headers.get("location");
    if (!location) throw new PublicFetchError("Redirect missing location", 502);
    current = await assertPublicUrl(new URL(location, current).toString());
  }
}
