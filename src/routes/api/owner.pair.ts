import { createFileRoute } from "@tanstack/react-router";
import { readString } from "@/lib/json";
import { ownerPost } from "@/lib/server/owner-http";
import { createPairing, redeemPairing } from "@/lib/server/owner";

export function handlePairCreate(request: Request): Promise<Response> {
  return ownerPost(request, async () => ({ body: await createPairing(request) }));
}

export function handlePairRedeem(request: Request): Promise<Response> {
  return ownerPost(request, async (body) => {
    const { cookies } = await redeemPairing(request, readString(body.code) ?? "");
    return { body: { ok: true }, cookies };
  });
}

export const Route = createFileRoute("/api/owner/pair")({
  server: {
    handlers: {
      POST: ({ request }) => handlePairCreate(request),
      PUT: ({ request }) => handlePairRedeem(request),
    },
  },
});
