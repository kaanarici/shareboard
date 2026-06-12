import { describe, expect, test } from "bun:test";
import { storedObjectHeaders } from "./r2";

describe("stored object response headers", () => {
  test("adds sandbox protections without replacing object metadata", () => {
    const headers = storedObjectHeaders({
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    });

    expect(headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Content-Type")).toBe("image/svg+xml");
    expect(headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });
});
