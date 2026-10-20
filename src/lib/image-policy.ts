import { LIMITS } from "@/lib/limits";

const WEBP_QUALITY = [0.84, 0.78, 0.72, 0.66];

export type OptimizedImage = {
  file: File;
  originalSize: number;
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
  if (file.size > LIMITS.maxImageInputBytes) {
    throw new Error(`Images must be under ${formatBytes(LIMITS.maxImageInputBytes)}`);
  }

  const originalSize = file.size;
  if (file.type === "image/svg+xml") {
    if (file.size > LIMITS.maxImageBytes) {
      throw new Error(`SVGs must be under ${formatBytes(LIMITS.maxImageBytes)}`);
    }
    const aspect = await measureSvgAspect(file);
    return { file, originalSize, aspect };
  }

  const bitmap = await createImageBitmap(file);
  const aspect = bitmap.width && bitmap.height ? bitmap.width / bitmap.height : undefined;
  try {
    const scale = Math.min(1, LIMITS.maxImageLongEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Could not optimize image");
    ctx.drawImage(bitmap, 0, 0, width, height);

    let best: File | null = null;
    for (const quality of WEBP_QUALITY) {
      const blob = await canvasToBlob(canvas, "image/webp", quality);
      if (!best || blob.size < best.size) {
        const type = blob.type || "image/webp";
        best = new File([blob], replaceExtension(file.name || "image", type === "image/png" ? "png" : "webp"), {
          type,
        });
      }
      if (blob.size <= LIMITS.maxImageBytes) break;
    }

    if (file.size <= LIMITS.maxImageBytes && (!best || best.size >= file.size)) {
      return { file, originalSize, aspect };
    }
    if (!best || best.size > LIMITS.maxImageBytes) {
      throw new Error(`This image could not be optimized below ${formatBytes(LIMITS.maxImageBytes)}`);
    }
    return { file: best, originalSize, aspect };
  } finally {
    bitmap.close();
  }
}

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
