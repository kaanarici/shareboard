import { errorFromResponse, isRecord, readResponseJson } from "@/lib/json";
import type { BoardListEntry } from "@/lib/boards";
import type { ShareCreateResponse } from "@/lib/types";

const REPLACE_CONFLICT_MESSAGE = "This share was edited or removed elsewhere. Refresh to continue.";

export async function postShare(form: FormData, isReplace: boolean, fallback: string): Promise<ShareCreateResponse> {
  const res = await fetch("/api/share", { method: "POST", body: form });
  if (!res.ok) {
    if (isReplace && (res.status === 403 || res.status === 404 || res.status === 409)) {
      throw new Error(REPLACE_CONFLICT_MESSAGE);
    }
    throw new Error(await errorFromResponse(res, fallback));
  }
  const body = await readResponseJson(res);
  if (!isRecord(body) || typeof body.id !== "string") throw new Error("Invalid share response");
  return { id: body.id };
}

export async function deleteRemoteShare(
  entry: Pick<BoardListEntry, "id" | "kind">,
  onError: (message: string) => void,
): Promise<boolean> {
  if (entry.kind === "tiny") return true;
  try {
    const res = await fetch(`/api/share?id=${encodeURIComponent(entry.id)}`, { method: "DELETE" });
    if (res.ok || res.status === 404) return true;
    onError(await errorFromResponse(res, "Failed to delete share"));
    return false;
  } catch {
    onError("Failed to delete share");
    return false;
  }
}
