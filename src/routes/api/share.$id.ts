import { createFileRoute } from "@tanstack/react-router";
import { boardAsJson } from "@/lib/canvas-sanitize";
import { rateLimitResponse } from "@/lib/server/rate-limit";
import { clientIp } from "@/lib/server/request";
import { keepShareId } from "@/lib/locked-envelope";
import { readShare } from "@/lib/server/share-store";
import { errorResponse, jsonResponse, objectHeaders } from "@/lib/server/http";

const MANIFEST_CACHE_CONTROL = "no-cache";

function matchesIfNoneMatch(request: Request, etag: string) {
  const header = request.headers.get("if-none-match");
  return !!header && header.split(",").some((part) => [etag, `W/${etag}`, "*"].includes(part.trim()));
}

export async function handleManifestGet(request: Request, rawId: string): Promise<Response> {
  const id = keepShareId(rawId);
  if (!id) return jsonResponse({ error: "Object not found" }, { status: 404 });
  const limited = await rateLimitResponse("publicRead", clientIp(request), "Too many board requests. Try again shortly.");
  if (limited) return limited;
  try {
    const record = await readShare(id);
    if (!record) return jsonResponse({ error: "Object not found" }, { status: 404 });
    if (record.kind === "locked") return jsonResponse({ id, encrypted: true, locked: true });
    const etag = `"${record.etag}"`;
    const headers = objectHeaders({ "Cache-Control": MANIFEST_CACHE_CONTROL, ETag: etag });
    if (matchesIfNoneMatch(request, etag)) return new Response(null, { status: 304, headers });
    return Response.json(boardAsJson(record.board), { headers });
  } catch (error) {
    return errorResponse(error, "Failed to read object");
  }
}

export const Route = createFileRoute("/api/share/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleManifestGet(request, params.id),
    },
  },
});
