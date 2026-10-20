import { createFileRoute } from "@tanstack/react-router";
import { errorResponse, jsonResponse } from "@/lib/server/http";
import { ownerStatus } from "@/lib/server/owner";

export async function handleOwnerStatus(request: Request): Promise<Response> {
  try {
    return jsonResponse(await ownerStatus(request));
  } catch (error) {
    return errorResponse(error, "Couldn't read owner status");
  }
}

export const Route = createFileRoute("/api/owner")({
  server: {
    handlers: {
      GET: ({ request }) => handleOwnerStatus(request),
    },
  },
});
