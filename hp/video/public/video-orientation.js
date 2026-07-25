const ORIENTATIONS = new Set(['vertical', 'horizontal', 'both']);

export function normalizeOrientation(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return ORIENTATIONS.has(normalized) ? normalized : 'both';
}

export function inferVideoOrientation(mediaUrl) {
  let pathname;
  try {
    pathname = new URL(mediaUrl).pathname;
  } catch {
    return 'unknown';
  }

  const matches = [...pathname.matchAll(/(?:^|\/)(\d{2,5})x(\d{2,5})(?:\/|$)/gi)];
  const match = matches.at(-1);
  if (!match) return 'unknown';

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'unknown';
  }
  if (height > width) return 'vertical';
  if (width > height) return 'horizontal';
  return 'square';
}

export function matchesOrientation(mediaUrl, orientation) {
  const normalized = normalizeOrientation(orientation);
  if (normalized === 'both') return true;
  return inferVideoOrientation(mediaUrl) === normalized;
}
