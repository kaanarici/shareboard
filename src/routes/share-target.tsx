import { createFileRoute } from "@tanstack/react-router";

const SHARE_PARAM_MAX = 4000;

function shareParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, SHARE_PARAM_MAX) : undefined;
}

function redirectToHome(params: { title?: unknown; text?: unknown; url?: unknown }) {
  const search = new URLSearchParams();
  const title = shareParam(params.title);
  if (title) search.set("title", title);
  const text = shareParam(params.text);
  if (text) search.set("text", text);
  const url = shareParam(params.url);
  if (url) search.set("url", url);
  const location = search.size > 0 ? `/?${search.toString()}` : "/";
  return new Response(null, { status: 303, headers: { Location: location } });
}

export const Route = createFileRoute("/share-target")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        return redirectToHome({
          title: url.searchParams.get("title"),
          text: url.searchParams.get("text"),
          url: url.searchParams.get("url"),
        });
      },
      POST: async ({ request }) => {
        const form = await request.formData().catch(() => null);
        return redirectToHome({
          title: form?.get("title"),
          text: form?.get("text"),
          url: form?.get("url"),
        });
      },
    },
  },
});
