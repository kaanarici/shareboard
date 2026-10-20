export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function badRequest(message: string): never {
  throw new HttpError(message, 400);
}

const OBJECT_SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "X-Content-Type-Options": "nosniff",
} as const;

export function objectHeaders(headers: HeadersInit = {}): Headers {
  const result = new Headers(headers);
  for (const [name, value] of Object.entries(OBJECT_SECURITY_HEADERS)) result.set(name, value);
  return result;
}

export function jsonResponse(body: unknown, init: ResponseInit = {}, cacheControl = "no-store"): Response {
  const headers = objectHeaders(init.headers);
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", cacheControl);
  return Response.json(body, { ...init, headers });
}

export function errorResponse(error: unknown, fallback: string): Response {
  if (error instanceof HttpError) return jsonResponse({ error: error.message }, { status: error.status });
  return jsonResponse({ error: fallback }, { status: 500 });
}
