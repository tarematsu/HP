import { inferMediaType } from './extractor.js';
import { resolveMediaHost } from './media-host.js';
import { normalizeVideoCandidates } from './video-candidates.js';

export function sourceMediaHost(env) {
  return resolveMediaHost(env);
}

export function normalizeSourceFeedItems(urls, mediaHost) {
  return normalizeVideoCandidates(urls, mediaHost).map((item) => ({
    ...item,
    type: inferMediaType(item.url)
  }));
}

export function selectUnseenItems(items, collectionSeenKeys) {
  if (!(collectionSeenKeys instanceof Set)) return items;
  return items.filter((item) => !collectionSeenKeys.has(item.key));
}
