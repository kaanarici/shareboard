/**
 * Pulls a server-supplied `error` string out of a JSON error response, or
 * falls back to a generic message. Used by the in-app fetch sites that hit
 * our own /api/* handlers.
 */
export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}
