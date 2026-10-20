import { afterEach, describe, expect, test } from "bun:test";
import { fetchPublicUrl, isBlockedHost, PublicFetchError } from "./safe-fetch";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(responses: Record<string, () => Response>) {
  const calls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      expect(init?.redirect).toBe("manual");
      expect(init?.method).toBe("GET");
      return (responses[url] ?? (() => new Response("ok")))();
    },
    { preconnect: realFetch.preconnect },
  );
  return calls;
}

async function rejection(url: string) {
  return fetchPublicUrl(url).then(
    () => null,
    (error: unknown) => error,
  );
}

describe("fetchPublicUrl host checks", () => {
  test("blocks private, loopback, and special-purpose IP literals in every spelling", async () => {
    const calls = stubFetch({});
    for (const url of [
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f.1/",
      "http://0177.0.0.1/",
      "http://10.1.2.3/",
      "http://100.64.0.1/",
      "http://169.254.169.254/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://198.18.0.1/",
      "http://224.0.0.1/",
      "http://255.255.255.255/",
      "http://0.0.0.0/",
      "http://[::]/",
      "http://[::1]/",
      "http://[fc00::1]/",
      "http://[fd12::1]/",
      "http://[fe80::1]/",
      "http://[ff02::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[::127.0.0.1]/",
      "http://[64:ff9b::7f00:1]/",
      "http://[2002:7f00:1::]/",
      "http://[2001::1]/",
      "http://[2001:db8::1]/",
    ]) {
      const error = await rejection(url);
      expect(error).toBeInstanceOf(PublicFetchError);
    }
    expect(calls).toEqual([]);
  });

  test("blocks local hostnames including trailing-dot and subdomain spellings", () => {
    for (const host of [
      "localhost",
      "LOCALHOST.",
      "app.localhost",
      "printer.local",
      "db.internal",
      "router.home.arpa",
      "intranet",
      "metadata.google.internal.",
    ]) {
      expect(isBlockedHost(host)).toBe(true);
    }
    for (const host of ["example.com", "localhost.example.com", "[2606:4700:4700::1111]", "1.1.1.1"]) {
      expect(isBlockedHost(host)).toBe(false);
    }
  });

  test("rejects credentials and non-http schemes", async () => {
    stubFetch({});
    for (const url of [
      "http://user:pass@example.com/",
      "ftp://example.com/",
      "file:///etc/passwd",
      "not a url",
      "http://example.com:6379/",
      "https://example.com:8443/",
    ]) {
      expect(await rejection(url)).toBeInstanceOf(PublicFetchError);
    }
  });

  test("re-checks every redirect hop and stops at private targets", async () => {
    const calls = stubFetch({
      "https://example.com/": () => new Response(null, { status: 302, headers: { Location: "https://example.org/next" } }),
      "https://example.org/next": () => new Response(null, { status: 307, headers: { Location: "http://127.0.0.1/admin" } }),
    });
    expect(await rejection("https://example.com/")).toBeInstanceOf(PublicFetchError);
    expect(calls).toEqual(["https://example.com/", "https://example.org/next"]);
  });

  test("limits redirect chains and requires a location", async () => {
    stubFetch({
      "https://a.example.com/": () => new Response(null, { status: 301, headers: { Location: "https://a.example.com/" } }),
      "https://b.example.com/": () => new Response(null, { status: 302 }),
    });
    const loop = await rejection("https://a.example.com/");
    expect(loop instanceof PublicFetchError && loop.message).toBe("Too many redirects");
    const missing = await rejection("https://b.example.com/");
    expect(missing instanceof PublicFetchError && missing.message).toBe("Redirect missing location");
  });

  test("allows public hosts", async () => {
    const calls = stubFetch({});
    const result = await fetchPublicUrl("http://[2606:4700:4700::1111]/");
    expect(result.response.status).toBe(200);
    expect(calls).toEqual(["http://[2606:4700:4700::1111]/"]);
  });
});
