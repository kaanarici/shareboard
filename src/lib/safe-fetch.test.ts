import { afterEach, describe, expect, test } from "bun:test";
import { fetchPublicUrl, PublicFetchError } from "./safe-fetch";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(calls: string[]) {
  globalThis.fetch = (async (input, init) => {
    calls.push(input.toString());
    expect(init?.redirect).toBe("manual");
    return new Response("ok");
  }) as typeof fetch;
}

describe("fetchPublicUrl IPv6 guards", () => {
  test("rejects bracketed private IPv6 literals before fetch", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    for (const url of [
      "http://[::]/",
      "http://[::1]/",
      "http://[fc00::1]/",
      "http://[fd00::1]/",
      "http://[fe80::1]/",
      "http://[febf::1]/",
      "http://[::ffff:10.0.0.1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:169.254.1.1]/",
      "http://[::ffff:192.168.1.1]/",
    ]) {
      const error = await fetchPublicUrl(url).then(
        () => null,
        (caught) => caught,
      );
      expect(error).toBeInstanceOf(PublicFetchError);
      expect(error.status).toBe(400);
    }

    expect(calls).toEqual([]);
  });

  test("allows bracketed public IPv6 literals", async () => {
    const calls: string[] = [];
    stubFetch(calls);

    const result = await fetchPublicUrl("http://[2606:4700:4700::1111]/");

    expect(result.response.status).toBe(200);
    expect(calls).toEqual(["http://[2606:4700:4700::1111]/"]);
  });
});
