export function getClientIp(request: Request): string | null {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return ip && ip.length > 0 ? ip : null;
}

/**
 * Reject cross-origin browser requests. Same-origin browser calls always send
 * `Origin`; server-side callers (curl, scripts) usually omit it — we allow the
 * absent case so smoke tests still work. Shape: "https://shareboard.example".
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}
