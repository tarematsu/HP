const ENTITIES = Object.freeze({
  '&nbsp;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&lt;': '<',
  '&gt;': '>',
});

export function decodeBasicHtml(value) {
  return String(value || '')
    .replace(/&(nbsp|amp|quot|#39|lt|gt);/g, (entity) => ENTITIES[entity] || entity)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function visibleHtmlText(html) {
  return decodeBasicHtml(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCompactCount(value) {
  const match = String(value || '').trim().match(/^([0-9][0-9,.]*)([KMB])?$/i);
  if (!match) return null;
  const number = Number(match[1].replaceAll(',', ''));
  if (!Number.isFinite(number) || number < 0) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[String(match[2] || '').toUpperCase()] || 1;
  return Math.round(number * multiplier);
}

export function firstHrefId(html, pattern) {
  const source = String(html || '');
  const match = source.match(pattern);
  return match?.[1] || null;
}

export function extractTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeBasicHtml(match[1]).replace(/\s+/g, ' ').trim() : null;
}
