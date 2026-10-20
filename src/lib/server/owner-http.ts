import { isRecord, readRequestJson } from "@/lib/json";
import { errorResponse, jsonResponse } from "@/lib/server/http";
import { rateLimitResponse } from "@/lib/server/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/server/request";

const MAX_OWNER_BODY_BYTES = 64 * 1024;

export async function ownerPost(
  request: Request,
  handle: (body: Record<string, unknown>) => Promise<{ body: unknown; cookies?: string[] }>,
): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Forbidden" }, { status: 403 });
  const limited = await rateLimitResponse("owner", clientIp(request), "Too many attempts. Try again in a minute.");
  if (limited) return limited;
  try {
    const parsed = await readRequestJson(request, MAX_OWNER_BODY_BYTES);
    const result = await handle(isRecord(parsed) ? parsed : {});
    const headers = new Headers();
    for (const value of result.cookies ?? []) headers.append("Set-Cookie", value);
    return jsonResponse(result.body, { headers });
  } catch (error) {
    return errorResponse(error, "Something went wrong");
  }
}
