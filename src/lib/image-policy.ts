"use client";

export const IMAGE_POLICY = {
  maxInputBytes: 50 * 1024 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
  maxBoardBytes: 75 * 1024 * 1024,
  maxLongEdge: 2400,
  webpQuality: [0.84, 0.78, 0.72, 0.66],
} as const;

export type OptimizedImage = {
  file: File;
  originalSize: number;
  /** Natural pxW/pxH of the source image. `undefined` when we couldn't measure (e.g. viewBox-only SVG). */
  aspect?: number;
};

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${Math.ceil(bytes / 1024 / 1024)} MB`;
}

export async function optimizeImageForShare(file: File): Promise<OptimizedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only images can be added to a board");
  }
  if (file.size > IMAGE_POLICY.maxInputBytes) {
    throw new Error(`Images must be under ${formatBytes(IMAGE_POLICY.maxInputBytes)}`);
  }

  const originalSize = file.size;
  if (file.type === "image/svg+xml") {
    if (file.size > IMAGE_POLICY.maxOutputBytes) {
      throw new Error(`SVGs must be under ${formatBytes(IMAGE_POLICY.maxOutputBytes)}`);
    }
    const aspect = await measureSvgAspect(file);
    return { file, originalSize, aspect };
  }

  const bitmap = await createImageBitmap(file);
  const aspect = bitmap.width && bitmap.height ? bitmap.width / bitmap.height : undefined;
  try {
    const scale = Math.min(1, IMAGE_POLICY.maxLongEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Could not optimize image");
    ctx.drawImage(bitmap, 0, 0, width, height);

    let best: File | null = null;
    for (const quality of IMAGE_POLICY.webpQuality) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      if (!best || blob.size < best.size) {
        const type = blob.type || "image/webp";
        best = new File([blob], replaceExtension(file.name || "image", type === "image/png" ? "png" : "webp"), {
          type,
        });
      }
      if (blob.size <= IMAGE_POLICY.maxOutputBytes) break;
    }

    if (file.size <= IMAGE_POLICY.maxOutputBytes && (!best || best.size >= file.size)) {
      return { file, originalSize, aspect };
    }
    if (!best || best.size > IMAGE_POLICY.maxOutputBytes) {
      throw new Error(`This image could not be optimized below ${formatBytes(IMAGE_POLICY.maxOutputBytes)}`);
    }
    return { file: best, originalSize, aspect };
  } finally {
    bitmap.close();
  }
}

// SVGs may only carry viewBox (no width/height), in which case `naturalWidth`
// is 0 and we can't safely derive aspect — return undefined so the tile falls
// back to the grid's default flex shape.
function measureSvgAspect(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (value: number | undefined) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      done(w && h ? w / h : undefined);
    };
    img.onerror = () => done(undefined);
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode image"));
    }, type, quality);
  });
}

function replaceExtension(name: string, ext: string) {
  const base = name.replace(/\.[^/.]+$/, "") || "image";
  return `${base}.${ext}`;
}
