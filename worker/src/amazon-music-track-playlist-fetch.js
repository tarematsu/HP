function requestUrl(input) {
  if (typeof input === 'string' || input instanceof URL) return new URL(input);
  return new URL(input.url);
}

function requestMethod(input, init) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

function jsonBody(value) {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function queryObject(searchParams) {
  const result = {};
  for (const [key, value] of searchParams.entries()) result[key] = value;
  return result;
}

export function normalizeAmazonTrackPlaylistActionRequest(input, init = {}) {
  const url = requestUrl(input);
  if (requestMethod(input, init) !== 'POST'
    || url.pathname !== '/api/cosmicTrack/showTrackDetailSeeMore'
    || !url.search) return null;

  const body = jsonBody(init?.body);
  return {
    url: `${url.origin}${url.pathname}`,
    init: {
      ...init,
      body: JSON.stringify({
        ...queryObject(url.searchParams),
        ...body,
      }),
    },
  };
}

export async function amazonMusicTrackPlaylistFetch(input, init = {}, fetchImpl = fetch) {
  const normalized = normalizeAmazonTrackPlaylistActionRequest(input, init);
  if (!normalized) return fetchImpl(input, init);
  return fetchImpl(normalized.url, normalized.init);
}
