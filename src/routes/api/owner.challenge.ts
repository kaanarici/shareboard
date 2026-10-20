import { createFileRoute } from "@tanstack/react-router";
import { readString } from "@/lib/json";
import { badRequest } from "@/lib/server/http";
import { ownerPost } from "@/lib/server/owner-http";
import { startClaim, startSignIn } from "@/lib/server/owner";

export function handleOwnerChallenge(request: Request): Promise<Response> {
  return ownerPost(request, async (body) => {
    const { options, cookie } =
      body.purpose === "claim"
        ? await startClaim(request, readString(body.setupCode) ?? "")
        : body.purpose === "signin"
          ? await startSignIn(request)
          : badRequest("Unknown passkey request");
    return { body: options, cookies: [cookie] };
  });
}

export const Route = createFileRoute("/api/owner/challenge")({
  server: {
    handlers: {
      POST: ({ request }) => handleOwnerChallenge(request),
    },
  },
});
