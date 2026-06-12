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

function normalizeHostname(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1).toLowerCase() : hostname.toLowerCase();
}

function ipv4FromMappedIpv6(address: string): string | null {
  const dotted = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

function firstIpv6Hextet(address: string): number | null {
  const first = address.split(":")[0];
  if (!/^[0-9a-f]{1,4}$/.test(first)) return null;
  return Number.parseInt(first, 16);
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase();
  const mappedIpv4 = ipv4FromMappedIpv6(normalized);
  if (mappedIpv4) return isPrivateIp(mappedIpv4);
  if (normalized === "::1" || normalized === "::" || normalized === "0.0.0.0") return true;
  if (normalized.includes(":")) {
    const first = firstIpv6Hextet(normalized);
    return first !== null && ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80);
  }

  const octets = normalized.split(".").map(Number);
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
  const hostname = normalizeHostname(url.hostname);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new PublicFetchError("Only http(s) URLs are allowed", 400);
  }
  if (url.username || url.password) {
    throw new PublicFetchError("Authenticated URLs are not allowed", 400);
  }
  if (["localhost", "localhost.localdomain"].includes(hostname) || hostname.endsWith(".local")) {
    throw new PublicFetchError("Private hosts are not allowed", 400);
  }

  const literal = isIP(hostname) ? hostname : null;
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
