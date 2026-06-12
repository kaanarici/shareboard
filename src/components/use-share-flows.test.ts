import { afterEach, describe, expect, test } from "bun:test";
import type { BoardHistoryEntry } from "@/lib/store";
import { shouldRemoveHistoryEntry } from "./use-share-flows";

const realFetch = globalThis.fetch;

const entry: BoardHistoryEntry = {
  id: "share-1",
  kind: "stored",
  title: "Board",
  subtitle: "Public share",
  shareUrl: "https://share.test/c/share-1",
  createdAt: "2026-06-12T00:00:00.000Z",
  itemCount: 1,
  pageCount: 1,
  deleteToken: "delete-token",
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(response: Response | Error) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
  return calls;
}

describe("shouldRemoveHistoryEntry", () => {
  test("keeps remote history entries on non-404 delete failures", async () => {
    const calls = stubFetch(Response.json({ error: "Delete token rejected" }, { status: 403 }));
    const messages: string[] = [];

    await expect(shouldRemoveHistoryEntry(entry, (message) => messages.push(message))).resolves.toBe(false);

    expect(messages).toEqual(["Delete token rejected"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe("DELETE");
    expect(calls[0]?.init?.headers).toEqual({ "x-delete-token": "delete-token" });
  });

  test("keeps remote history entries on network failures", async () => {
    stubFetch(new Error("offline"));
    const messages: string[] = [];

    await expect(shouldRemoveHistoryEntry(entry, (message) => messages.push(message))).resolves.toBe(false);

    expect(messages).toEqual(["Failed to delete share"]);
  });

  test("drops remote history entries only after success or already-gone response", async () => {
    stubFetch(new Response(null, { status: 404 }));
    await expect(shouldRemoveHistoryEntry(entry, () => {})).resolves.toBe(true);

    stubFetch(new Response(null, { status: 204 }));
    await expect(shouldRemoveHistoryEntry(entry, () => {})).resolves.toBe(true);
  });
});
