import { publishedDate, stripHtml } from './official-news-html.js';

// News navigation and latest_newslist live INSIDE post_body. Only the nested
// post_body_in div is article content; never fall back to the entire document.
function classElement(html, tag, className) {
  const tags = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  let start = null;
  let depth = 0;
  for (const match of html.matchAll(tags)) {
    const closing = /^<\//.test(match[0]);
    if (start === null) {
      const classes = match[0].match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1].split(/\s+/) || [];
      if (closing || !classes.includes(className)) continue;
      start = match.index + match[0].length;
      depth = 1;
    } else if (closing) {
      depth -= 1;
      if (depth === 0) return html.slice(start, match.index);
    } else {
      depth += 1;
    }
  }
  return null;
}

export function parseNogizakaNewsArticle(source) {
  const html = String(source || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const header = classElement(html, 'header', 'post_header');
  const body = classElement(html, 'div', 'post_body_in');
  const title = stripHtml(header?.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  const dateArea = header == null ? null : classElement(header, 'div', 'post_header_data');
  // A layout change must fail parsing rather than revive sidebar announcements.
  if (!title || body == null || !stripHtml(body)) {
    throw new Error('Nogizaka official news article structure unavailable');
  }
  return { title, text: stripHtml(body), publishedDate: publishedDate(stripHtml(dateArea)) };
}
