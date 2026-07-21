import {
  canonicalVideoKey,
  normalizeVideoUrl
} from './extractor.js';

export function normalizeVideoCandidates(urls, mediaHost) {
  const items = [];
  const seen = new Set();
  for (const value of urls || []) {
    const url = normalizeVideoUrl(value, mediaHost);
    const key = url && canonicalVideoKey(url, mediaHost);
    if (!url || !key || seen.has(key)) continue;
    seen.add(key);
    items.push({ url, key });
  }
  return items;
}

export function splitKnownVideoCandidates(items, seenKeys) {
  if (!(seenKeys instanceof Set) || !seenKeys.size) {
    return { knownItems: [], uncheckedItems: items || [] };
  }
  const knownItems = [];
  const uncheckedItems = [];
  for (const item of items || []) {
    if (seenKeys.has(item.key)) knownItems.push(item);
    else uncheckedItems.push(item);
  }
  return { knownItems, uncheckedItems };
}
