import { createFileRoute } from "@tanstack/react-router";
import { isPreviewKey, isPublicObjectKey } from "@/lib/storage-keys";
import { rateLimitResponse } from "@/lib/server/rate-limit";
import { clientIp } from "@/lib/server/request";
import { errorResponse, jsonResponse, objectHeaders } from "@/lib/server/http";
import { getObject } from "@/lib/server/storage";

const OBJECT_CACHE_CONTROL = "private, max-age=31536000, immutable";
const PREVIEW_CACHE_CONTROL = "public, max-age=31536000, immutable";

export async function handleObjectGet(request: Request): Promise<Response> {
  const limited = await rateLimitResponse("objects", clientIp(request), "Too many object requests. Try again shortly.");
  if (limited) return limited;
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!isPublicObjectKey(key)) return jsonResponse({ error: "Invalid object key" }, { status: 400 });
  try {
    const object = await getObject(key);
    if (!object) return jsonResponse({ error: "Object not found" }, { status: 404 });
    return new Response(object.bytes, {
      headers: objectHeaders({ "Content-Type": object.contentType, "Cache-Control": isPreviewKey(key) ? PREVIEW_CACHE_CONTROL : OBJECT_CACHE_CONTROL }),
    });
  } catch (error) {
    return errorResponse(error, "Failed to read object");
  }
}

export const Route = createFileRoute("/api/objects")({
  server: {
    handlers: {
      GET: ({ request }) => handleObjectGet(request),
    },
  },
});
