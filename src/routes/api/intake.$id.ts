import { createFileRoute } from "@tanstack/react-router";
import { consumeIntake, deleteIntake, intakeCookie, intakeOwnedBy, keepIntakeId } from "@/lib/server/share-intake";
import { rateLimitResponse } from "@/lib/server/rate-limit";
import { clientIp, isSameOrigin } from "@/lib/server/request";
import { errorResponse, jsonResponse } from "@/lib/server/http";

export async function handleIntakeGet(request: Request, rawId: string): Promise<Response> {
  const id = keepIntakeId(rawId);
  if (!id || !intakeOwnedBy(request, id)) return jsonResponse({ error: "Intake not found" }, { status: 404 });
  const limited = await rateLimitResponse("publicRead", clientIp(request), "Too many intake requests. Try again shortly.");
  if (limited) return limited;
  try {
    const form = await consumeIntake(id);
    if (!form) return jsonResponse({ error: "Intake not found" }, { status: 404 });
    return new Response(form, { headers: { "Cache-Control": "no-store", "Set-Cookie": intakeCookie(id, 0) } });
  } catch (error) {
    return errorResponse(error, "Failed to read intake");
  }
}

export async function handleIntakeDelete(request: Request, rawId: string): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Forbidden" }, { status: 403 });
  const id = keepIntakeId(rawId);
  if (!id || !intakeOwnedBy(request, id)) return jsonResponse({ error: "Intake not found" }, { status: 404 });
  await deleteIntake(id).catch(() => undefined);
  return jsonResponse({ ok: true });
}

export const Route = createFileRoute("/api/intake/$id")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleIntakeGet(request, params.id),
      DELETE: ({ request, params }) => handleIntakeDelete(request, params.id),
    },
  },
});
