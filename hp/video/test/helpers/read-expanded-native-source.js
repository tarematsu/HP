import { readFileSync } from 'node:fs';

const splitMediaInclude = /^#include "(media_(?:tver|youtube)_[^"]+\.inc)"$/gm;

export function readExpandedNativeSource(relativePath, metaUrl) {
  const seen = new Set();
  const expand = url => {
    const key = url.href;
    if (seen.has(key)) return '';
    seen.add(key);
    const source = readFileSync(url, 'utf8');
    return source.replace(splitMediaInclude, (_match, includeName) =>
      expand(new URL(includeName, url)));
  };
  return expand(new URL(relativePath, metaUrl));
}
