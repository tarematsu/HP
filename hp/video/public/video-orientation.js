const PROFILES = new Set([
  'vertical-720',
  'vertical-1080',
  'horizontal-720',
  'horizontal-1080'
]);

const LEGACY_PROFILE_MAP = Object.freeze({
  vertical: 'vertical-720',
  horizontal: 'horizontal-720',
  both: 'vertical-720'
});

export function normalizeOrientation(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (PROFILES.has(normalized)) return normalized;
  return LEGACY_PROFILE_MAP[normalized] || 'vertical-720';
}

export function inferVideoDimensions(mediaUrl) {
  let pathname;
  try {
    pathname = new URL(mediaUrl).pathname;
  } catch {
    return null;
  }

  const matches = [...pathname.matchAll(/(?:^|\/)(\d{2,5})x(\d{2,5})(?:\/|$)/gi)];
  const match = matches.at(-1);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

export function inferVideoOrientation(mediaUrl) {
  const dimensions = inferVideoDimensions(mediaUrl);
  if (!dimensions) return 'unknown';

  const { width, height } = dimensions;
  if (height > width) return 'vertical';
  if (width > height) return 'horizontal';
  return 'square';
}

export function matchesOrientation(mediaUrl, profile) {
  const normalized = normalizeOrientation(profile);
  const dimensions = inferVideoDimensions(mediaUrl);
  if (!dimensions) return false;

  const { width, height } = dimensions;
  const orientation = height > width ? 'vertical' : width > height ? 'horizontal' : 'square';
  const separator = normalized.lastIndexOf('-');
  if (orientation !== normalized.slice(0, separator)) return false;

  const shortEdge = Math.min(width, height);
  const resolution = normalized.slice(separator + 1);
  if (resolution === '1080') return shortEdge >= 1080;
  return shortEdge >= 720 && shortEdge < 1080;
}
