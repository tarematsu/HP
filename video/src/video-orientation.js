export const MIN_VIDEO_LONG_EDGE = 1280;
export const MIN_VIDEO_SHORT_EDGE = 720;

const VIDEO_DIMENSION_SEGMENT = /(?:^|\/)(\d{2,5})x(\d{2,5})(?=\/|$)/gi;

export function normalizeVideoOrientationFilter(value) {
  if (value === 'vertical' || value === 'horizontal') return value;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'vertical' || normalized === 'horizontal' ? normalized : 'both';
}

function absoluteUrlPathname(value) {
  const raw = String(value || '');
  const schemeEnd = raw.indexOf('://');
  if (schemeEnd <= 0) return null;

  const authorityStart = schemeEnd + 3;
  const pathStart = raw.indexOf('/', authorityStart);
  const queryStart = raw.indexOf('?', authorityStart);
  const hashStart = raw.indexOf('#', authorityStart);
  let authorityEnd = raw.length;
  if (pathStart >= 0) authorityEnd = Math.min(authorityEnd, pathStart);
  if (queryStart >= 0) authorityEnd = Math.min(authorityEnd, queryStart);
  if (hashStart >= 0) authorityEnd = Math.min(authorityEnd, hashStart);
  if (authorityEnd <= authorityStart) return null;
  if (pathStart < 0 || pathStart > authorityEnd) return '/';

  let pathEnd = raw.length;
  if (queryStart > pathStart) pathEnd = Math.min(pathEnd, queryStart);
  if (hashStart > pathStart) pathEnd = Math.min(pathEnd, hashStart);
  return raw.slice(pathStart, pathEnd);
}

export function inferVideoDimensions(mediaUrl) {
  const pathname = absoluteUrlPathname(mediaUrl);
  if (pathname === null) return null;

  // Keep only the final dimensions segment without materializing every match.
  // The lookahead preserves adjacent matches such as `640x360/720x1280`.
  VIDEO_DIMENSION_SEGMENT.lastIndex = 0;
  let match = null;
  let candidate;
  while ((candidate = VIDEO_DIMENSION_SEGMENT.exec(pathname)) !== null) {
    match = candidate;
  }
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

export function isVideoResolutionAllowed(mediaUrl) {
  const dimensions = inferVideoDimensions(mediaUrl);
  if (!dimensions) return true;

  const longEdge = Math.max(dimensions.width, dimensions.height);
  const shortEdge = Math.min(dimensions.width, dimensions.height);
  return longEdge >= MIN_VIDEO_LONG_EDGE && shortEdge >= MIN_VIDEO_SHORT_EDGE;
}

export function inferVideoOrientation(mediaUrl) {
  const dimensions = inferVideoDimensions(mediaUrl);
  if (!dimensions) return 'unknown';

  const { width, height } = dimensions;
  if (height > width) return 'vertical';
  if (width > height) return 'horizontal';
  return 'square';
}
