import { afterEach, describe, expect, test } from "bun:test";
import { deleteRemoteShare } from "./share-api";

const realFetch = globalThis.fetch;

const entry = {
  id: "share-1",
  kind: "stored" as const,
};

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(response: Response | Error) {
  const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (response instanceof Error) throw response;
      return response;
    },
    { preconnect: realFetch.preconnect },
  );
  return calls;
}

describe("deleteRemoteShare", () => {
  test("keeps remote board entries on non-404 delete failures", async () => {
    const calls = stubFetch(Response.json({ error: "Only the owner can do that" }, { status: 403 }));
    const messages: string[] = [];

    await expect(deleteRemoteShare(entry, (message) => messages.push(message))).resolves.toBe(false);

    expect(messages).toEqual(["Only the owner can do that"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.method).toBe("DELETE");
  });

  test("keeps remote board entries on network failures", async () => {
    stubFetch(new Error("offline"));
    const messages: string[] = [];

    await expect(deleteRemoteShare(entry, (message) => messages.push(message))).resolves.toBe(false);

    expect(messages).toEqual(["Failed to delete share"]);
  });

  test("drops remote board entries only after success or already-gone response", async () => {
    stubFetch(new Response(null, { status: 404 }));
    await expect(deleteRemoteShare(entry, () => undefined)).resolves.toBe(true);

    stubFetch(new Response(null, { status: 204 }));
    await expect(deleteRemoteShare(entry, () => undefined)).resolves.toBe(true);
  });
});
