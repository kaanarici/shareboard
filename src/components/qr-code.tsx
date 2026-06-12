import { renderSVG } from "uqr";

const QR_SIZE = 216;

export default function QrCodeView({ url }: { url: string }) {
  // The markup is produced by uqr from our own share URL (not user-authored
  // HTML), so injecting it is safe. We force width/height so the viewBox-only
  // <svg> fills the square tile instead of the browser's 300x150 default.
  const svg = renderSVG(url, { ecc: "M", border: 2 }).replace(
    "<svg ",
    '<svg width="100%" height="100%" ',
  );

  return (
    <div
      role="img"
      aria-label="QR code linking to this board"
      className="setup-dialog-tile mx-auto items-center justify-center"
      style={{ width: QR_SIZE, height: QR_SIZE, padding: 12 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
