import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const SITE_DESCRIPTION = "A canvas for links, notes, and images. Share the whole board as one link.";

export const getSiteOrigin = createServerFn({ method: "GET" }).handler(() => new URL(getRequest().url).origin);

export function siteMeta(origin: string | undefined) {
  const image = origin ? `${origin}/og.png` : null;
  return [
    { property: "og:title", content: "Shareboard" },
    { property: "og:description", content: SITE_DESCRIPTION },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
    ...(image
      ? [
          { property: "og:image", content: image },
          { property: "og:image:width", content: "1200" },
          { property: "og:image:height", content: "630" },
          { name: "twitter:image", content: image },
        ]
      : []),
  ];
}
