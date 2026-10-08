// Preserve existing Stationhead API paths while sharing source-scoped track reads.
import { normalizePlayedRows, normalizeLikes } from './normalize.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createStationheadTrackHistoryClient(source, artistFilter, fetchJson) {
  if (!['buddies', 'ohisama'].includes(source)) throw new Error(`Unsupported track-history source: ${source}`);
  const prefix = source === 'buddies' ? '' : `source=${encodeURIComponent(source)}&`;
  const endpoint = (query) => `/api/track-history?${prefix}${query}`;
  const normalizedArtist = artistFilter.normalize('NFKC');

  return {
    async loadIndex(options) {
      const payload = await fetchJson(endpoint('dates_only=1'), options);
      return (Array.isArray(payload?.dates) ? payload.dates : [])
        .filter((date) => DATE_PATTERN.test(String(date)))
        .sort();
    },
    async loadPeriod(from, to, options) {
      const payload = await fetchJson(
        endpoint(`from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=10000&ranking=0`),
        options,
      );
      return normalizePlayedRows(payload?.rows);
    },
    async loadLikes(options) {
      const payload = await fetchJson(endpoint('ranking_only=1&ranking_limit=500'), options);
      return normalizeLikes(payload?.ranking)
        .filter((row) => !row.artist || row.artist.normalize('NFKC').includes(normalizedArtist));
    },
  };
}
