const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return new TextDecoder("ascii").decode(bytes.subarray(offset, offset + length));
}

export function sniffRasterImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= PNG.length && matches(bytes, 0, PNG)) return "image/png";
  if (bytes.length >= 3 && matches(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return "image/gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

export function verifiedRasterMime(bytes: Uint8Array, declaredType: string): string | null {
  const detected = sniffRasterImageMime(bytes);
  if (!detected) return null;
  const declared = declaredType.toLowerCase().trim();
  if (!declared || declared === detected || (declared === "image/jpg" && detected === "image/jpeg")) {
    return detected;
  }
  return null;
}
