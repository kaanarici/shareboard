import { toPng } from "html-to-image";

const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;

/**
 * Snapshots a DOM node to a PNG sized for OG/Twitter cards (1200x630).
 * Iframes are filtered because cross-origin embeds taint the canvas and cannot
 * be exported. Their card placeholders below remain visible.
 */
export async function capturePreview(node: HTMLElement): Promise<Blob | null> {
  await waitForFontsAndImages(node);
  try {
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const scale = Math.min(PREVIEW_WIDTH / rect.width, PREVIEW_HEIGHT / rect.height, 1.5);
    const dataUrl = await toPng(node, {
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      canvasWidth: PREVIEW_WIDTH,
      canvasHeight: PREVIEW_HEIGHT,
      backgroundColor: "#ffffff",
      pixelRatio: 1,
      cacheBust: true,
      style: {
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      },
      filter: (n) => !(n instanceof HTMLIFrameElement),
    });
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return blob.size > 2048 ? blob : fallbackPreview(node);
  } catch {
    return fallbackPreview(node);
  }
}

async function waitForFontsAndImages(node: HTMLElement) {
  if (document.fonts?.ready) {
    await document.fonts.ready.catch(() => undefined);
  }
  const imgs = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return undefined;
      return new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });
    })
  );
}

function fallbackPreview(node: HTMLElement): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = PREVIEW_WIDTH;
  canvas.height = PREVIEW_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);

  const lines = (node.innerText || "Shareboard")
    .split(/\s*\n+\s*/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 7);
  const title = lines[0] || "Shareboard";
  const body = lines.slice(1).join("  ");

  ctx.fillStyle = "#f5f5f0";
  ctx.fillRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 70, 70, PREVIEW_WIDTH - 140, PREVIEW_HEIGHT - 140, 28);
  ctx.fill();
  ctx.strokeStyle = "#e0e0da";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#0a0a0a";
  ctx.font = "700 56px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
  drawWrappedText(ctx, title, 116, 160, PREVIEW_WIDTH - 232, 68, 2);
  if (body) {
    ctx.fillStyle = "#525252";
    ctx.font = "400 32px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    drawWrappedText(ctx, body, 116, 330, PREVIEW_WIDTH - 232, 46, 4);
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/);
  let line = "";
  let drawn = 0;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }
    if (line) ctx.fillText(drawn === maxLines - 1 ? `${line}...` : line, x, y + drawn * lineHeight);
    drawn += 1;
    if (drawn >= maxLines) return;
    line = word;
  }
  if (line && drawn < maxLines) ctx.fillText(line, x, y + drawn * lineHeight);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
