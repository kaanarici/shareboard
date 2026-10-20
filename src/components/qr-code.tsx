import { renderSVG } from "uqr";

const QR_SIZE = 220;

export default function QrCodeView({ url }: { url: string }) {
  const svg = renderSVG(url, { ecc: "M", border: 2 }).replace(
    "<svg ",
    '<svg width="100%" height="100%" ',
  );

  return (
    <div
      role="img"
      aria-label="QR code linking to this board"
      className="board-pass-qr"
      style={{ width: QR_SIZE, height: QR_SIZE }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
