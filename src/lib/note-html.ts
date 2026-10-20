export function noteHtmlFromIntake(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return trimmed;
  return `<p>${trimmed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
}

const BLOCK_TAG = /<\/?(?:p|div|h[1-6]|li|ul|ol|blockquote|pre|br|hr)\b[^>]*>/gi;
const TEXT_ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

export function notePlainText(html: string): string {
  return html
    .replace(BLOCK_TAG, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/gi, (entity, name: string) => TEXT_ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n\s*/g, "\n")
    .trim();
}
