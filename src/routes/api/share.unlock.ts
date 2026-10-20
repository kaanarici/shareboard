import { createFileRoute } from "@tanstack/react-router";
import { isRecord, readRequestJson } from "@/lib/json";
import { rateLimitResponse } from "@/lib/server/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/server/request";
import { releaseUnlockAttempt, reserveUnlockAttempt, verifyPin } from "@/lib/server/locked-share";
import { keepShareId } from "@/lib/locked-envelope";
import { readPin } from "@/lib/server/share-build";
import { readLockedShare } from "@/lib/server/share-store";
import { errorResponse, jsonResponse } from "@/lib/server/http";

const TOO_MANY = "Too many unlock attempts. Try again shortly.";

export async function handleUnlock(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Forbidden" }, { status: 403 });
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return jsonResponse({ error: "Invalid request" }, { status: 400 });
  }
  const ipLimited = await rateLimitResponse("unlock", clientIp(request), TOO_MANY);
  if (ipLimited) return ipLimited;

  const body = await readRequestJson(request, 1024);
  const id = isRecord(body) ? keepShareId(body.id) : "";
  const pin = isRecord(body) ? readPin(body.pin) : "";
  if (!id || !pin) return jsonResponse({ error: "Invalid request" }, { status: 400 });

  const boardLimited = await rateLimitResponse("unlockBoard", id, TOO_MANY);
  if (boardLimited) return boardLimited;

  try {
    const record = await readLockedShare(id);
    if (!record) return jsonResponse({ error: "Board not found" }, { status: 404 });
    if (!(await reserveUnlockAttempt(id))) {
      return jsonResponse({ error: TOO_MANY }, { status: 429, headers: { "Retry-After": "3600" } });
    }
    if (!record.pinVerifier || !(await verifyPin(pin, record.pinVerifier))) {
      return jsonResponse({ error: "Invalid PIN" }, { status: 403 });
    }
    await releaseUnlockAttempt(id);
    return jsonResponse(record.envelope);
  } catch (error) {
    return errorResponse(error, "Failed to unlock board");
  }
}

export const Route = createFileRoute("/api/share/unlock")({
  server: {
    handlers: {
      POST: ({ request }) => handleUnlock(request),
    },
  },
});
