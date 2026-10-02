import { REGIONAL_MUSIC_ARTISTS } from './regional-music-service-registry.js';
import {
  saveRegionalCollectorState,
  saveRegionalPlaylist,
  saveRegionalPlaylistMembership,
  saveRegionalPlaylistSnapshot,
  saveRegionalTrack,
} from './regional-music-store.js';

export const KKBOX_JAPANESE_CATEGORY = '308';
export const KKBOX_REQUEST_DELAY_MS = 250;
export const KKBOX_CHARTS = Object.freeze(
  ['tw', 'hk'].flatMap((territory) => ['daily', 'weekly'].flatMap((period) =>
    ['song', 'newrelease'].map((type) => Object.freeze({ territory, period, type })))),
);

function normalize(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s,、，/／・･._-]+/g, '');
}

const KKBOX_HISTORY_ARTISTS = Object.freeze({
  ...REGIONAL_MUSIC_ARTISTS,
  keyakizaka46: Object.freeze({
    displayName: '欅坂46',
    aliases: Object.freeze(['欅坂46', 'Keyakizaka46', 'KEYAKIZAKA46']),
  }),
  hiragana_keyakizaka46: Object.freeze({
    displayName: 'けやき坂46',
    aliases: Object.freeze(['けやき坂46', 'Hiragana Keyakizaka46', 'HIRAGANA KEYAKIZAKA46', 'Hiragana Keyaki']),
  }),
});

const artistMatchers = Object.freeze(
  Object.entries(KKBOX_HISTORY_ARTISTS).flatMap(([canonicalArtist, definition]) =>
    definition.aliases.map((alias) => Object.freeze({
      canonical_artist: canonicalArtist,
      alias: normalize(alias),
    }))),
);

export function canonicalKkboxArtists(value) {
  const text = normalize(value);
  if (!text) return [];
  return [...new Set(artistMatchers
    .filter((item) => text.includes(item.alias))
    .map((item) => item.canonical_artist))];
}

export function kkboxChartId({ territory, period, type }) {
  return `chart:${KKBOX_JAPANESE_CATEGORY}:${territory}:${period}:${type}`;
}

export function kkboxChartPageUrl({ territory, period, type }) {
  return `https://kma.kkbox.com/charts/${period}/${type}?cate=${KKBOX_JAPANESE_CATEGORY}&lang=tc&terr=${territory}`;
}

export function kkboxChartApiUrl({ territory, period, type, date = null, limit = 100 }) {
  const params = new URLSearchParams({
    category: KKBOX_JAPANESE_CATEGORY,
    lang: 'tc',
    limit: String(limit),
    terr: territory,
    type,
  });
  if (date) params.set('date', String(date).slice(0, 10));
  return `https://kma.kkbox.com/charts/api/v1/${period}?${params}`;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : null;
}

export function parseKkboxChartPayload(payload, chart) {
  if (!payload || String(payload.code ?? '0') !== '0') {
    throw new Error(`KKBOX API code ${payload?.code ?? 'missing'}${payload?.message ? `: ${payload.message}` : ''}`);
  }
  const providerDate = String(payload?.data?.date || '').slice(0, 10) || null;
  const rawRows = payload?.data?.charts?.[chart.type];
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const entries = [];
  for (const row of rows) {
    const trackId = String(row?.song_id || '').trim();
    const rank = positiveInteger(row?.rankings?.this_period ?? row?.ranking ?? row?.rank);
    if (!trackId || !rank) continue;
    const artistName = String(row?.artist_name || '').trim();
    const artistRoles = String(row?.artist_roles || '').trim();
    const canonicalArtists = canonicalKkboxArtists(`${artistName} ${artistRoles}`);
    if (!canonicalArtists.length) continue;
    entries.push({
      track_id: trackId,
      rank,
      previous_rank: positiveInteger(row?.rankings?.last_period),
      title: row?.song_name ?? null,
      artist_name: artistName || null,
      artist_roles: artistRoles || null,
      album_name: row?.album_name ?? null,
      track_url: row?.song_url ?? null,
      artist_url: row?.artist_url ?? null,
      album_url: row?.album_url ?? null,
      release_date: Number.isFinite(Number(row?.release_date)) ? Number(row.release_date) : null,
      canonical_artists: canonicalArtists,
    });
  }
  return {
    provider_date: providerDate,
    source_rows: rows.length,
    entries: entries.sort((a, b) => a.rank - b.rank || String(a.title || '').localeCompare(String(b.title || ''))),
  };
}

async function sleep(ms) {
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(response, attempt) {
  const retryAfter = Number(response?.headers?.get?.('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(60_000, retryAfter * 1000);
  return [2_000, 5_000, 12_000, 25_000][attempt] || 25_000;
}

export async function fetchKkboxChart(chart, {
  date = null,
  fetchImpl = fetch,
  sleepImpl = sleep,
  retries = 3,
} = {}) {
  const url = kkboxChartApiUrl({ ...chart, date });
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          accept: 'application/json,text/plain,*/*',
          'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7,ja;q=0.6',
          'user-agent': 'Mozilla/5.0 compatible; skrzk-pages-kkbox/1.0',
          referer: 'https://kma.kkbox.com/',
        },
        signal: AbortSignal.timeout(25_000),
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`KKBOX HTTP ${response.status}`);
        if (attempt < retries) {
          await sleepImpl(retryAfterMs(response, attempt));
          continue;
        }
        throw lastError;
      }
      if (!response.ok) throw new Error(`KKBOX HTTP ${response.status}`);
      const payload = await response.json();
      return {
        ...parseKkboxChartPayload(payload, chart),
        requested_date: date ? String(date).slice(0, 10) : null,
        source_url: url,
        status: response.status,
      };
    } catch (error) {
      lastError = error;
      if (attempt < retries && error?.name !== 'AbortError') {
        await sleepImpl([1_000, 2_500, 6_000][attempt] || 6_000);
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error('KKBOX request failed');
}

function playlistName(chart) {
  const territory = chart.territory === 'tw' ? '台湾' : '香港';
  const period = chart.period === 'daily' ? '日次' : '週次';
  const type = chart.type === 'newrelease' ? '新曲' : '楽曲';
  return `KKBOX ${territory} 日語${type}${period}榜`;
}

async function saveChart(env, chart, result, observedAt) {
  const playlistId = kkboxChartId(chart);
  await saveRegionalPlaylist(env, {
    service: 'kkbox',
    service_playlist_id: playlistId,
    playlist_name: playlistName(chart),
    playlist_url: kkboxChartPageUrl(chart),
    playlist_type: 'chart',
    owner_name: 'KKBOX',
    territory: chart.territory,
    chart_period: chart.period,
    chart_type: chart.type,
    category: KKBOX_JAPANESE_CATEGORY,
    provider_date: result.provider_date,
    requested_date: result.provider_date,
    source_rows: result.source_rows,
    observed_at: observedAt,
  });
  await saveRegionalPlaylistSnapshot(env, {
    service: 'kkbox',
    service_playlist_id: playlistId,
    item_count: result.entries.length,
    source_item_count: result.source_rows,
    provider_date: result.provider_date,
    observed_at: observedAt,
  });

  for (const entry of result.entries) {
    const canonicalArtist = entry.canonical_artists.length === 1 ? entry.canonical_artists[0] : null;
    await saveRegionalTrack(env, {
      service: 'kkbox',
      service_track_id: entry.track_id,
      canonical_artist: canonicalArtist,
      canonical_artists: entry.canonical_artists,
      title: entry.title,
      artist_name: entry.artist_name,
      artist_roles: entry.artist_roles,
      album_name: entry.album_name,
      track_url: entry.track_url,
      release_date: entry.release_date,
      observed_at: observedAt,
    });
    await saveRegionalPlaylistMembership(env, {
      service: 'kkbox',
      service_playlist_id: playlistId,
      service_track_id: entry.track_id,
      position: entry.rank,
      previous_position: entry.previous_rank,
      canonical_artists: entry.canonical_artists,
      artist_name: entry.artist_name,
      artist_roles: entry.artist_roles,
      provider_date: result.provider_date,
      territory: chart.territory,
      chart_period: chart.period,
      chart_type: chart.type,
      observed_at: observedAt,
    });
  }
}

export async function collectKkbox(
  env,
  observedAt = Date.now(),
  fetchImpl = fetch,
  { requestDelayMs = KKBOX_REQUEST_DELAY_MS, sleepImpl = sleep } = {},
) {
  const failures = [];
  let charts = 0;
  let tracks = 0;
  let memberships = 0;
  const uniqueTracks = new Set();

  for (let index = 0; index < KKBOX_CHARTS.length; index += 1) {
    const chart = KKBOX_CHARTS[index];
    try {
      const result = await fetchKkboxChart(chart, { fetchImpl, sleepImpl });
      await saveChart(env, chart, result, observedAt);
      charts += 1;
      memberships += result.entries.length;
      result.entries.forEach((entry) => uniqueTracks.add(entry.track_id));
    } catch (error) {
      failures.push({
        territory: chart.territory,
        period: chart.period,
        type: chart.type,
        error: String(error?.message || error),
      });
    }
    if (index + 1 < KKBOX_CHARTS.length) await sleepImpl(requestDelayMs);
  }
  tracks = uniqueTracks.size;

  const status = failures.length === 0 ? 'ok' : charts ? 'degraded' : 'error';
  await saveRegionalCollectorState(env, {
    service: 'kkbox',
    status,
    last_attempt_at: observedAt,
    last_success_at: charts ? observedAt : null,
    last_error_class: failures.length ? 'collection_error' : null,
    last_error_message: failures.length ? JSON.stringify(failures).slice(0, 1000) : null,
    entity_counts: {
      charts,
      tracks,
      playlist_memberships: memberships,
      failures: failures.length,
    },
    updated_at: observedAt,
  });

  return {
    service: 'kkbox',
    status,
    charts,
    tracks,
    playlist_memberships: memberships,
    failures,
  };
}
