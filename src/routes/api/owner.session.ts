import { createFileRoute } from "@tanstack/react-router";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { isRecord, readString } from "@/lib/json";
import { badRequest, jsonResponse } from "@/lib/server/http";
import { ownerPost } from "@/lib/server/owner-http";
import { isSameOrigin } from "@/lib/server/request";
import { clearedSessionCookie, finishClaim, finishSignIn, signOut } from "@/lib/server/owner";

function readPasskeyResponse<T extends RegistrationResponseJSON | AuthenticationResponseJSON>(
  value: unknown,
  guard: (value: Record<string, unknown>) => value is Record<string, unknown> & T,
): T {
  if (!isRecord(value) || !guard(value)) badRequest("Invalid passkey response");
  return value;
}

function isRegistration(value: Record<string, unknown>): value is Record<string, unknown> & RegistrationResponseJSON {
  return typeof value.id === "string" && isRecord(value.response) && typeof value.response.attestationObject === "string";
}

function isAuthentication(value: Record<string, unknown>): value is Record<string, unknown> & AuthenticationResponseJSON {
  return typeof value.id === "string" && isRecord(value.response) && typeof value.response.signature === "string";
}

export function handleOwnerSessionCreate(request: Request): Promise<Response> {
  return ownerPost(request, async (body) => {
    const result =
      body.purpose === "claim"
        ? await finishClaim(request, readString(body.setupCode) ?? "", readPasskeyResponse(body.response, isRegistration))
        : body.purpose === "signin"
          ? await finishSignIn(request, readPasskeyResponse(body.response, isAuthentication))
          : badRequest("Unknown passkey request");
    return { body: { ok: true }, cookies: result.cookies };
  });
}

export async function handleOwnerSignOut(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) return jsonResponse({ error: "Forbidden" }, { status: 403 });
  await signOut(request).catch(() => undefined);
  return jsonResponse({ ok: true }, { headers: { "Set-Cookie": clearedSessionCookie() } });
}

export const Route = createFileRoute("/api/owner/session")({
  server: {
    handlers: {
      POST: ({ request }) => handleOwnerSessionCreate(request),
      DELETE: ({ request }) => handleOwnerSignOut(request),
    },
  },
});
