import { normalizeMediaHost } from './extractor.js';
import { mediaHostFor } from './source-locator.js';

let cachedSource;
let cachedHost = '';

export function resolveMediaHost(env) {
  const source = mediaHostFor(env);
  if (source === cachedSource && cachedHost) return cachedHost;

  const host = normalizeMediaHost(source);
  cachedSource = source;
  cachedHost = host;
  return host;
}
