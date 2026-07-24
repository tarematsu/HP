import {
  normalizeVideoCandidates,
  splitKnownVideoCandidates
} from './video-candidates.js';
import {
  inferVideoOrientation,
  isVideoResolutionAllowed
} from './video-orientation.js';

export function normalizeCollectionCandidates(urls, host) {
  const items = [];
  let lowResolutionCount = 0;
  for (const item of normalizeVideoCandidates(urls, host)) {
    if (!isVideoResolutionAllowed(item.url)) {
      lowResolutionCount += 1;
      continue;
    }
    items.push({ ...item, orientation: inferVideoOrientation(item.url) });
  }
  return { items, lowResolutionCount };
}

export function splitKnownCollectionItems(items, seenKeys) {
  return splitKnownVideoCandidates(items, seenKeys);
}
