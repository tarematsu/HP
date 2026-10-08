const SCRIPT_HTML = /<script[\s\S]*?<\/script>/gi;
const STYLE_HTML = /<style[\s\S]*?<\/style>/gi;
const HTML_TAG = /<[^>]+>/g;
const HTML_SPACE = /\s+/g;

export function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function stripHtml(value: string): string {
  return value.replace(SCRIPT_HTML, " ").replace(STYLE_HTML, " ").replace(HTML_TAG, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"').replace(HTML_SPACE, " ").trim();
}
