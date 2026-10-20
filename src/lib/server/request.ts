import { readBoundedBody } from "@/lib/json";
import { HttpError } from "@/lib/server/http";

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

class RequestTooLargeError extends HttpError {
  constructor() {
    super("Request is too large", 413);
    this.name = "RequestTooLargeError";
  }
}

export async function readBoundedFormData(request: Request, maxBytes: number): Promise<FormData> {
  const body = await readBoundedBody(request, maxBytes);
  if (!body) throw new RequestTooLargeError();
  return new Request(request.url, { method: "POST", headers: request.headers, body }).formData();
}
