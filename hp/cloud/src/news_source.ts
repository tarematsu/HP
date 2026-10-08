import { fetchText } from "./http";
import { stripHtml } from "./source_parse";
import type { SourceResult } from "./source_types";

const NEWS_ITEM = /<item>([\s\S]*?)<\/item>/gi;
const NEWS_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const NEWS_DESCRIPTION = /<description[^>]*>([\s\S]*?)<\/description>/i;
const NEWS_LINK = /<link[^>]*>([\s\S]*?)<\/link>/i;
const NEWS_PUBLISHED = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i;
function rssValue(body: string, pattern: RegExp): string { return stripHtml(pattern.exec(body)?.[1] ?? ""); }

export async function fetchNews(): Promise<SourceResult> {
  const xml = await fetchText("https://news.web.nhk/n-data/conf/na/rss/cat0.xml");
  const items: Array<{ title: string; description: string; link: string; publishedAt: string }> = [];
  NEWS_ITEM.lastIndex = 0; let inspected = 0;
  for (let match = NEWS_ITEM.exec(xml); match && inspected < 10; match = NEWS_ITEM.exec(xml)) {
    inspected += 1; const body = match[1] ?? ""; const title = rssValue(body, NEWS_TITLE); if (!title) continue;
    items.push({ title, description: rssValue(body, NEWS_DESCRIPTION), link: rssValue(body, NEWS_LINK), publishedAt: rssValue(body, NEWS_PUBLISHED) });
  }
  NEWS_ITEM.lastIndex = 0;
  if (!items.length) throw new Error("NHK RSS contained no items");
  return { source: "news", payload: { title: "NHKニュース", items }, observedAt: Date.now() };
}
