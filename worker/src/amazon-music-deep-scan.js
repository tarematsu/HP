import { extractAmazonMusicTracks } from './amazon-music-web-client.js';
import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

const AMAZON_HOST = 'music.amazon.co.jp';
const AMAZON_ORIGIN = `https://${AMAZON_HOST}`;
const CONFIG_URL = `${AMAZON_ORIGIN}/config.json?skipToken=false&clientApplication=skyfire`;
const WEB_SKILL_BASE = 'https://fe.web.skill.music.a2z.com/api';
const CATALOG_SKILL_BASE = 'https://fe.mesk.skill.music.a2z.com/api';
const OVERALL_CHART_PAGE_URL = `${AMAZON_ORIGIN}/popular/songs/browsePanel/popularTracks`;
const OVERALL_CHART_INITIAL_URL = `${CATALOG_SKILL_BASE}/showChartsWidget?genreTitle=browsePanel&genreId=popularTracks&widgetId=top-songs&userHash=%7B%22level%22%3A%22LIBRARY_MEMBER%22%7D`;
const USER_HASH = JSON.stringify({ level: 'LIBRARY_MEMBER' });
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const RETRY_ATTEMPTS = 6;

export const AMAZON_MUSIC_DEEP_SCAN_TARGET_RANK = 1_000_000;
export const AMAZON_MUSIC_DEEP_SCAN_PAGES_PER_RUN = 550;
export const AMAZON_MUSIC_DEEP_SCAN_STATE_KEY = 'amazon-music/catalog-popular/deep-scan/state.json';
const ARTIST_LATEST_KEY = 'amazon-music/artist/B08P3RHP1P/latest.json';
const READ_MODEL_KEY = 'amazon-music/read-model/latest.json';
const PUBLIC_MODEL_KEY = pagesActionsR2ResponseKey('amazon-music');
const PUBLIC_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  vary: 'accept-encoding',
});

function text(value) {
  if (value === null || value === undefined) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function deepValues(value, visit, depth = 0) {
  if (depth > 20 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const child of value) deepValues(child, visit, depth + 1);
    return;
  }
  const entry = object(value);
  if (!entry) return;
  visit(entry);
  for (const child of Object.values(entry)) deepValues(child, visit, depth + 1);
}

function nextChartsWidgetUrl(document) {
  let found = null;
  deepValues(document, (node) => {
    if (found) return;
    for (const value of Object.values(node)) {
      if (typeof value !== 'string'
        || !value.includes('/api/showChartsWidget?')
        || !value.includes('widgetId=top-songs')
        || !value.includes('next=')) continue;
      try {
        found = new URL(value, CATALOG_SKILL_BASE).toString();
        return;
      } catch {
        // Ignore malformed pagination actions.
      }
    }
  });
  return found;
}

function isErrorOnlyPayload(document) {
  let hasContent = false;
  let hasError = false;
  deepValues(document, (node) => {
    const iface = text(node?.interface) || '';
    if (iface.includes('DetailTemplateInterface')
      || iface.includes('VerticalListTemplateInterface')
      || iface.includes('TrackListTemplateInterface')) hasContent = true;
    const message = text(node?.message);
    if (message && /アクションを完了できません|unable to complete|service error/i.test(message)) hasError = true;
  });
  return hasError && !hasContent;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function responseJson(response, label) {
  if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}`);
  const value = await response.json();
  if (!object(value)) throw new Error(`${label} returned a non-object payload`);
  return value;
}

async function amazonConfig(fetchImpl) {
  const response = await fetchImpl(CONFIG_URL, {
    method: 'POST',
    headers: {
      accept: '*/*',
      'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
      'user-agent': USER_AGENT,
      referer: `${AMAZON_ORIGIN}/`,
    },
  });
  return responseJson(response, 'Amazon Music config');
}

function outerHeaders() {
  return {
    accept: '*/*',
    'accept-language': 'ja-JP,ja;q=0.9,en;q=0.5',
    'content-type': 'text/plain;charset=UTF-8',
    origin: AMAZON_ORIGIN,
    referer: `${AMAZON_ORIGIN}/`,
    'user-agent': USER_AGENT,
  };
}

function amazonHeaders(configuration, pageUrl) {
  const csrf = object(configuration?.csrf) || {};
  return {
    'x-amzn-authentication': JSON.stringify({
      interface: 'ClientAuthenticationInterface.v1_0.ClientTokenElement',
      accessToken: configuration?.accessToken || '',
    }),
    'x-amzn-device-model': 'WEBPLAYER',
    'x-amzn-device-width': '1920',
    'x-amzn-device-family': 'WebPlayer',
    'x-amzn-device-id': configuration?.deviceId || '',
    'x-amzn-user-agent': USER_AGENT,
    'x-amzn-session-id': configuration?.sessionId || '',
    'x-amzn-device-height': '1080',
    'x-amzn-request-id': crypto.randomUUID(),
    'x-amzn-device-language': 'ja_JP',
    'x-amzn-currency-of-preference': 'JPY',
    'x-amzn-os-version': '1.0',
    'x-amzn-application-version': configuration?.version || '',
    'x-amzn-device-time-zone': 'UTC',
    'x-amzn-timestamp': String(Date.now()),
    'x-amzn-csrf': JSON.stringify({
      interface: 'CSRFInterface.v1_0.CSRFHeaderElement',
      token: csrf.token || '',
      timestamp: csrf.ts == null ? '' : String(csrf.ts),
      rndNonce: csrf.rnd == null ? '' : String(csrf.rnd),
    }),
    'x-amzn-music-domain': AMAZON_HOST,
    'x-amzn-referer': '',
    'x-amzn-affiliate-tags': '',
    'x-amzn-ref-marker': '',
    'x-amzn-page-url': pageUrl,
    'x-amzn-weblab-id-overrides': '',
    'x-amzn-video-player-token': '',
    'x-amzn-feature-flags': 'hd-supported,uhd-supported',
    'x-amzn-has-profile-id': '',
    'x-amzn-age-band': '',
  };
}

async function primeWebPlayer(fetchImpl, configuration) {
  const artistId = 'B08P3RHP1P';
  const pageUrl = `${AMAZON_ORIGIN}/artists/${artistId}`;
  const response = await fetchImpl(`${WEB_SKILL_BASE}/showHome`, {
    method: 'POST',
    headers: outerHeaders(),
    body: JSON.stringify({
      deeplink: JSON.stringify({
        interface: 'DeeplinkInterface.v1_0.DeeplinkClientInformation',
        deeplink: `/artists/${artistId}`,
      }),
      headers: JSON.stringify(amazonHeaders(configuration, pageUrl)),
    }),
  });
  await responseJson(response, 'Amazon Music /showHome');
}

async function fetchChartPage(fetchImpl, configuration, url) {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: outerHeaders(),
      body: JSON.stringify({
        headers: JSON.stringify(amazonHeaders(configuration, OVERALL_CHART_PAGE_URL)),
      }),
    });
    if (response.status === 429) {
      await sleep(Math.min(15_000, 1_000 * (2 ** attempt)));
      continue;
    }
    const document = await responseJson(response, 'Amazon Music overall chart');
    if (isErrorOnlyPayload(document)) {
      throw new Error('Amazon Music overall chart returned an error template');
    }
    return document;
  }
  throw new Error('Amazon Music overall chart rate-limit retries exhausted');
}

export async function scanAmazonOverallBatch(fetchImpl = fetch, options = {}) {
  const startRank = Math.max(0, Number(options.startRank) || 0);
  const targetRank = Math.max(startRank, Number(options.targetRank) || AMAZON_MUSIC_DEEP_SCAN_TARGET_RANK);
  const maxPages = Math.max(1, Number(options.maxPages) || AMAZON_MUSIC_DEEP_SCAN_PAGES_PER_RUN);
  const targetIds = new Set((options.targetIds || []).map((value) => text(value)).filter(Boolean));
  const configuration = await amazonConfig(fetchImpl);
  await primeWebPlayer(fetchImpl, configuration);

  const hits = [];
  const seenUrls = new Set();
  const seenTrackIds = new Set();
  let url = text(options.startUrl) || OVERALL_CHART_INITIAL_URL;
  let scannedTracks = startRank;
  let pagesScanned = 0;
  let exhausted = false;
  let targetReached = scannedTracks >= targetRank;

  while (!targetReached && pagesScanned < maxPages) {
    if (!url || seenUrls.has(url)) {
      exhausted = true;
      break;
    }
    seenUrls.add(url);

    const document = await fetchChartPage(fetchImpl, configuration, url);
    pagesScanned += 1;
    const pageTracks = extractAmazonMusicTracks(document);
    const fresh = pageTracks.filter((track) => {
      const id = text(track?.amazon_music_id);
      return id && !seenTrackIds.has(id);
    });
    if (!fresh.length) {
      exhausted = true;
      break;
    }

    for (const track of fresh) {
      if (scannedTracks >= targetRank) break;
      seenTrackIds.add(track.amazon_music_id);
      scannedTracks += 1;
      if (targetIds.has(track.amazon_music_id)) {
        hits.push({ ...track, rank: scannedTracks });
      }
    }

    targetReached = scannedTracks >= targetRank;
    if (targetReached) {
      url = null;
      break;
    }

    const next = nextChartsWidgetUrl(document);
    if (!next || seenUrls.has(next)) {
      exhausted = true;
      url = null;
      break;
    }
    url = next;
  }

  return {
    hits,
    scanned_tracks: scannedTracks,
    pages_scanned: pagesScanned,
    next_url: targetReached || exhausted ? null : url,
    target_rank: targetRank,
    target_reached: targetReached,
    exhausted,
    complete: targetReached || exhausted,
  };
}

async function getJson(r2, key) {
  if (typeof r2?.get !== 'function') return null;
  const stored = await r2.get(key);
  if (!stored) return null;
  try {
    if (typeof stored.json === 'function') return await stored.json();
    if (typeof stored.text === 'function') return JSON.parse(await stored.text());
  } catch {
    return null;
  }
  return null;
}

async function putJson(r2, key, value) {
  const body = JSON.stringify(value);
  await r2.put(key, body, { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
  return body.length;
}

function normalizeHit(hit) {
  return {
    rank: Number(hit?.rank) || null,
    amazon_music_id: text(hit?.amazon_music_id),
    track_id: Number.isSafeInteger(Number(hit?.track_id)) ? Number(hit.track_id) : null,
    title: text(hit?.title),
    artist: text(hit?.artist),
    album: text(hit?.album),
    image: text(hit?.image),
  };
}

function mergeStateHits(previous = [], fresh = []) {
  const byId = new Map();
  for (const item of previous) {
    const hit = normalizeHit(item);
    if (hit.amazon_music_id && hit.rank) byId.set(hit.amazon_music_id, hit);
  }
  for (const item of fresh) {
    const hit = normalizeHit(item);
    if (hit.amazon_music_id && hit.rank) byId.set(hit.amazon_music_id, hit);
  }
  return [...byId.values()].sort((a, b) => a.rank - b.rank);
}

function mergePublishedHits(snapshotHits = [], stateHits = [], freshScanLimit = 0) {
  const current = new Map();
  const freshIds = new Set();
  for (const item of snapshotHits) {
    const hit = normalizeHit(item);
    if (!hit.amazon_music_id || !hit.rank) continue;
    freshIds.add(hit.amazon_music_id);
    current.set(hit.amazon_music_id, hit);
  }
  for (const item of stateHits) {
    const hit = normalizeHit(item);
    if (!hit.amazon_music_id || !hit.rank) continue;
    if (hit.rank <= freshScanLimit && !freshIds.has(hit.amazon_music_id)) continue;
    if (!current.has(hit.amazon_music_id)) current.set(hit.amazon_music_id, hit);
  }
  return [...current.values()].sort((a, b) => a.rank - b.rank);
}

function attachTrackIds(hits, snapshot) {
  const trackIds = new Map((snapshot?.all_tracks || [])
    .map((track) => [text(track?.amazon_music_id), Number(track?.track_id)])
    .filter(([id, trackId]) => id && Number.isSafeInteger(trackId)));
  return hits.map((hit) => ({ ...hit, track_id: trackIds.get(hit.amazon_music_id) ?? hit.track_id ?? null }));
}

async function publishProgress(r2, state, observedAt) {
  const snapshot = await getJson(r2, ARTIST_LATEST_KEY);
  if (!snapshot) return { published: false, bytes_written: 0, hit_count: state.hits.length };

  const freshScanLimit = Number(snapshot.catalog_popular_scanned) || 0;
  const mergedHits = attachTrackIds(
    mergePublishedHits(snapshot.catalog_popular_hits, state.hits, freshScanLimit),
    snapshot,
  );
  const updatedSnapshot = {
    ...snapshot,
    observed_at: observedAt,
    catalog_popular_hits: mergedHits,
    catalog_popular_scanned: Math.max(freshScanLimit, Number(state.scanned_tracks) || 0),
    catalog_popular_exhausted: Boolean(state.exhausted),
    catalog_popular_target_rank: Number(state.target_rank) || AMAZON_MUSIC_DEEP_SCAN_TARGET_RANK,
    catalog_popular_target_reached: Boolean(state.target_reached),
  };

  let bytesWritten = await putJson(r2, ARTIST_LATEST_KEY, updatedSnapshot);
  const model = await getJson(r2, READ_MODEL_KEY);
  if (!model) return { published: false, bytes_written: bytesWritten, hit_count: mergedHits.length };

  const rankById = new Map(mergedHits.map((hit) => [hit.amazon_music_id, Number(hit.rank) || null]));
  const updateTracks = (tracks = []) => tracks.map((track) => ({
    ...track,
    amazon_rank: rankById.get(track.amazon_music_id) ?? null,
  }));
  const updatedModel = {
    ...model,
    observed_at: observedAt,
    tracks: updateTracks(model.tracks),
    history: (Array.isArray(model.history) ? model.history : []).map((point) => (
      point?.snapshot_date === model.snapshot_date
        ? { ...point, observed_at: observedAt, tracks: updateTracks(point.tracks) }
        : point
    )),
  };
  bytesWritten += await putJson(r2, READ_MODEL_KEY, updatedModel);

  if (PUBLIC_MODEL_KEY) {
    const body = JSON.stringify({ ok: true, ...updatedModel });
    const envelope = {
      version: 1,
      status: 200,
      headers: PUBLIC_HEADERS,
      updated_at: observedAt,
      cadence_seconds: 0,
      source_revision: `amazon-music-deep-scan:${updatedModel.snapshot_date}:${state.scanned_tracks}:${observedAt}`,
      renderer_revision: 'amazon-music-v1',
      body,
    };
    await r2.put(PUBLIC_MODEL_KEY, JSON.stringify(envelope), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
    bytesWritten += body.length;
  }

  return { published: true, bytes_written: bytesWritten, hit_count: mergedHits.length };
}

function targetIdsFromSnapshot(snapshot) {
  return (snapshot?.all_tracks || []).map((track) => text(track?.amazon_music_id)).filter(Boolean);
}

function newState(now, targetIds) {
  return {
    version: 1,
    started_at: now,
    updated_at: now,
    completed_at: null,
    target_rank: AMAZON_MUSIC_DEEP_SCAN_TARGET_RANK,
    scanned_tracks: 0,
    pages_scanned: 0,
    batches: 0,
    next_url: OVERALL_CHART_INITIAL_URL,
    target_reached: false,
    exhausted: false,
    complete: false,
    target_ids: [...targetIds].sort(),
    hits: [],
  };
}

export async function continueAmazonMusicDeepScan(env, now = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (typeof r2?.get !== 'function' || typeof r2?.put !== 'function') {
    throw new Error('PAGES_RESPONSE_R2 binding is required');
  }

  const observedAt = Number(now) || Date.now();
  const snapshot = await getJson(r2, ARTIST_LATEST_KEY);
  const targetIds = targetIdsFromSnapshot(snapshot);
  if (!targetIds.length) {
    return { ok: true, skipped: true, reason: 'amazon-music-snapshot-unavailable' };
  }

  let state = await getJson(r2, AMAZON_MUSIC_DEEP_SCAN_STATE_KEY);
  const currentTargetKey = [...targetIds].sort().join(',');
  const stateTargetKey = Array.isArray(state?.target_ids) ? [...state.target_ids].sort().join(',') : '';
  if (!state || state.version !== 1 || (state.complete && currentTargetKey !== stateTargetKey)) {
    state = newState(observedAt, targetIds);
  }

  if (state.complete) {
    const published = await publishProgress(r2, state, observedAt);
    return {
      ok: true,
      complete: true,
      target_reached: Boolean(state.target_reached),
      exhausted: Boolean(state.exhausted),
      scanned_tracks: Number(state.scanned_tracks) || 0,
      target_rank: Number(state.target_rank) || AMAZON_MUSIC_DEEP_SCAN_TARGET_RANK,
      hits: state.hits?.length || 0,
      ...published,
    };
  }

  const batch = await scanAmazonOverallBatch(fetchImpl, {
    targetIds,
    startUrl: state.next_url,
    startRank: state.scanned_tracks,
    targetRank: state.target_rank,
    maxPages: AMAZON_MUSIC_DEEP_SCAN_PAGES_PER_RUN,
  });

  state = {
    ...state,
    updated_at: observedAt,
    completed_at: batch.complete ? observedAt : null,
    scanned_tracks: batch.scanned_tracks,
    pages_scanned: (Number(state.pages_scanned) || 0) + batch.pages_scanned,
    batches: (Number(state.batches) || 0) + 1,
    next_url: batch.next_url,
    target_reached: batch.target_reached,
    exhausted: batch.exhausted,
    complete: batch.complete,
    target_ids: [...targetIds].sort(),
    hits: mergeStateHits(state.hits, batch.hits),
  };

  let bytesWritten = await putJson(r2, AMAZON_MUSIC_DEEP_SCAN_STATE_KEY, state);
  const published = await publishProgress(r2, state, observedAt);
  bytesWritten += published.bytes_written;

  return {
    ok: true,
    complete: state.complete,
    target_reached: state.target_reached,
    exhausted: state.exhausted,
    scanned_tracks: state.scanned_tracks,
    target_rank: state.target_rank,
    pages_scanned_this_run: batch.pages_scanned,
    pages_scanned_total: state.pages_scanned,
    batches: state.batches,
    hits: state.hits.length,
    published: published.published,
    bytes_written: bytesWritten,
  };
}
