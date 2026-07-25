const HOMEPANEL_EXACT_PATHS = new Set(['/admin', '/v1']);

export function requestFamily(pathname) {
  return HOMEPANEL_EXACT_PATHS.has(pathname) || pathname.startsWith('/v1/')
    ? 'homepanel'
    : 'video';
}
