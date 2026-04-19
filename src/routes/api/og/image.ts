import { createFileRoute } from "@tanstack/react-router";
import { fetchPublicUrl, BROWSER_UA } from "@/lib/safe-fetch";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const FALLBACK_CACHE = "public, max-age=86400, stale-while-revalidate=604800";

export const Route = createFileRoute("/api/og/image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const rawUrl = new URL(request.url).searchParams.get("url");
        if (!rawUrl) {
          return Response.json({ error: "Missing url parameter" }, { status: 400 });
        }

        let upstream: Response;
        try {
          upstream = await fetchPublicUrl(rawUrl, {
            headers: {
              "User-Agent": BROWSER_UA,
              Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
            signal: AbortSignal.timeout(8000),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Fetch failed";
          const status = /private hosts|allowed/i.test(message) ? 400 : 502;
          return Response.json({ error: message }, { status });
        }

        if (!upstream.ok || !upstream.body) {
          return Response.json({ error: "Upstream rejected" }, { status: 502 });
        }

        const contentType = upstream.headers.get("content-type") || "";
        if (!contentType.toLowerCase().startsWith("image/")) {
          return Response.json({ error: "Not an image" }, { status: 415 });
        }

        const declaredLength = Number(upstream.headers.get("content-length") || "0");
        if (declaredLength && declaredLength > MAX_IMAGE_BYTES) {
          return Response.json({ error: "Image too large" }, { status: 413 });
        }

        const limited = new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = upstream.body!.getReader();
            let total = 0;
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.byteLength;
                if (total > MAX_IMAGE_BYTES) {
                  controller.error(new Error("Image too large"));
                  await reader.cancel().catch(() => {});
                  return;
                }
                controller.enqueue(value);
              }
              controller.close();
            } catch (err) {
              controller.error(err);
            }
          },
        });

        const headers = new Headers();
        headers.set("Content-Type", contentType);
        headers.set(
          "Cache-Control",
          upstream.headers.get("cache-control") || FALLBACK_CACHE
        );
        const etag = upstream.headers.get("etag");
        if (etag) headers.set("ETag", etag);

        return new Response(limited, { headers });
      },
    },
  },
});
