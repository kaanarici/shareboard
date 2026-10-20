import { createFileRoute } from "@tanstack/react-router";
import { errorResponse, jsonResponse } from "@/lib/server/http";
import { isSameOrigin } from "@/lib/server/request";
import { removeDevice, requireOwner } from "@/lib/server/owner";

export async function handleDeviceRemove(request: Request, id: string): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Forbidden" }, { status: 403 });
  try {
    await requireOwner(request);
    await removeDevice(id);
    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse(error, "Couldn't remove that device");
  }
}

export const Route = createFileRoute("/api/owner/devices/$id")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => handleDeviceRemove(request, params.id),
    },
  },
});
