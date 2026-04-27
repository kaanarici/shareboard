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
    return await res.blob();
  } catch {
    return null;
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
