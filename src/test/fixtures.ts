export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);

export function pngFile(name: string, body = "png-bytes"): File {
  return new File([PNG_SIGNATURE, body], name, { type: "image/png" });
}

export function defined<T>(value: T | null | undefined, label = "value"): T {
  if (value === null || value === undefined) throw new Error(`expected ${label}`);
  return value;
}
