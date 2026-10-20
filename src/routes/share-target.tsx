import { createFileRoute } from "@tanstack/react-router";
import { randomBytes } from "node:crypto";
import { shareParam } from "@/lib/intake";
import { LIMITS } from "@/lib/limits";
import { intakeCookie, storeIntakeFiles } from "@/lib/server/share-intake";
import { takeRateLimit } from "@/lib/server/rate-limit";
import { clientIp, readBoundedFormData } from "@/lib/server/request";
import { isOwnerRequest } from "@/lib/server/owner";

type HomeParams = {
  title?: FormDataEntryValue | null;
  text?: FormDataEntryValue | null;
  url?: FormDataEntryValue | null;
  intake?: string;
};

function redirectToHome(params: HomeParams): Response {
  const search = new URLSearchParams();
  if (params.intake) search.set("intake", params.intake);
  for (const name of ["title", "text", "url"] as const) {
    const value = shareParam(params[name]);
    if (value) search.set(name, value);
  }
  const location = search.size > 0 ? `/?${search.toString()}` : "/";
  return new Response(null, { status: 303, headers: { Location: location } });
}

async function stashFiles(form: FormData): Promise<string | undefined> {
  const files = [...new Set(form.keys())]
    .flatMap((name) => form.getAll(name))
    .filter((value) => value instanceof File)
    .filter((file) => file.size > 0);
  if (files.length === 0) return undefined;
  const id = randomBytes(18).toString("base64url");
  try {
    const manifest = await storeIntakeFiles(id, files);
    return manifest.files.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

export async function handleShareTargetPost(request: Request): Promise<Response> {
  if (!(await takeRateLimit("shareCreate", clientIp(request)))) return redirectToHome({});
  const form = await readBoundedFormData(request, LIMITS.maxBoardImageBytes + 1024 * 1024).catch(() => null);
  if (!form) return redirectToHome({});
  const crossSite = request.headers.get("sec-fetch-site") === "cross-site";
  const intake = crossSite || !(await isOwnerRequest(request)) ? undefined : await stashFiles(form);
  const response = redirectToHome({ intake, title: form.get("title"), text: form.get("text"), url: form.get("url") });
  if (intake) response.headers.append("Set-Cookie", intakeCookie(intake, 3600));
  return response;
}

export const Route = createFileRoute("/share-target")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const url = new URL(request.url);
        return redirectToHome({
          title: url.searchParams.get("title"),
          text: url.searchParams.get("text"),
          url: url.searchParams.get("url"),
        });
      },
      POST: ({ request }) => handleShareTargetPost(request),
    },
  },
});
