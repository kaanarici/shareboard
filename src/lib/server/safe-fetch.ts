import { isIP } from "node:net";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_SUFFIXES = ["localhost", "local", "internal", "home.arpa", "test", "invalid", "example", "onion"];

const BLOCKED_IPV4_RANGES: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export class PublicFetchError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "PublicFetchError";
  }
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((value, part) => value * 256 + part, 0);
}

function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToInt(address);
  if (value === null) return true;
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const start = ipv4ToInt(base) ?? 0;
    const size = 2 ** (32 - bits);
    return value >= start && value < start + size;
  });
}

function ipv6Hextets(address: string): number[] | null {
  let text = address;
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted?.[1] && dotted[2]) {
    const v4 = ipv4ToInt(dotted[2]);
    if (v4 === null) return null;
    text = `${dotted[1]}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string | undefined) => (part ? part.split(":").map((group) => Number.parseInt(group, 16)) : []);
  const head = parse(halves[0]);
  const tail = parse(halves[1]);
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<number>(Math.max(0, missing)).fill(0), ...tail];
  return groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

function isBlockedIpv6(address: string): boolean {
  const groups = ipv6Hextets(address);
  const first = groups?.[0];
  const second = groups?.[1];
  if (!groups || first === undefined || second === undefined) return true;
  if ((first & 0xe000) !== 0x2000) return true;
  if (first === 0x2001 && (second === 0 || second === 0x0db8 || (second & 0xffe0) === 0x0010 || (second & 0xffe0) === 0x0020)) {
    return true;
  }
  return first === 0x2002;
}

export function isBlockedHost(rawHostname: string): boolean {
  const bracketed = rawHostname.startsWith("[") && rawHostname.endsWith("]");
  const hostname = (bracketed ? rawHostname.slice(1, -1) : rawHostname).toLowerCase().replace(/\.+$/, "");
  const family = isIP(hostname);
  if (family === 4) return isBlockedIpv4(hostname);
  if (family === 6) return isBlockedIpv6(hostname);
  if (!hostname.includes(".")) return true;
  return BLOCKED_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function assertPublicUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicFetchError("Invalid URL", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PublicFetchError("Only http(s) URLs are allowed", 400);
  }
  if (url.username || url.password) throw new PublicFetchError("Authenticated URLs are not allowed", 400);
  if (url.port) throw new PublicFetchError("Only default ports are allowed", 400);
  if (isBlockedHost(url.hostname)) throw new PublicFetchError("Private hosts are not allowed", 400);
  return url;
}

export async function fetchPublicUrl(
  value: string,
  init: { headers?: HeadersInit; signal?: AbortSignal } = {},
  maxRedirects = 3,
): Promise<{ response: Response; url: string }> {
  let current = assertPublicUrl(value);
  for (let redirects = 0; ; redirects += 1) {
    const response = await fetch(current, { ...init, method: "GET", redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, url: current.toString() };
    await response.body?.cancel().catch(() => undefined);
    if (redirects >= maxRedirects) throw new PublicFetchError("Too many redirects", 502);
    const location = response.headers.get("location");
    if (!location) throw new PublicFetchError("Redirect missing location", 502);
    current = assertPublicUrl(new URL(location, current).toString());
  }
}
