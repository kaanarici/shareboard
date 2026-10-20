import { describe, expect, test } from "bun:test";
import { withSecurityHeaders } from "./security-headers";

describe("withSecurityHeaders", () => {
  test("preserves the response while hardening dynamic routes", async () => {
    const response = withSecurityHeaders(
      new Response("ok", {
        status: 202,
        headers: { "Cache-Control": "no-store" },
      }),
    );

    expect(response.status).toBe(202);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(response.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(response.headers.get("Content-Security-Policy")).toBe("object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  });

  test("never weakens a stricter policy a route already set", () => {
    const response = withSecurityHeaders(
      new Response("bytes", { headers: { "Content-Security-Policy": "default-src 'none'; sandbox" } }),
    );
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
  });
});
