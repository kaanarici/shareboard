import { describe, expect, test } from "bun:test";
import { sniffRasterImageMime, verifiedRasterMime } from "./image-mime";

describe("server image upload validation", () => {
  test("recognizes supported raster signatures", () => {
    expect(sniffRasterImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]))).toBe("image/png");
    expect(sniffRasterImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe("image/jpeg");
    expect(sniffRasterImageMime(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(sniffRasterImageMime(new TextEncoder().encode("RIFF0000WEBP"))).toBe("image/webp");
  });

  test("rejects active content and misleading declarations", () => {
    const svg = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");
    expect(verifiedRasterMime(svg, "image/svg+xml")).toBeNull();
    expect(
      verifiedRasterMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), "image/jpeg"),
    ).toBeNull();
  });
});
