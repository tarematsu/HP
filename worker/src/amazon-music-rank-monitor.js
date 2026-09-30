import { extractAmazonMusicTracks } from './amazon-music-web-client.js';

const AMAZON_HOST = 'music.amazon.co.jp';
const AMAZON_ORIGIN = `https://${AMAZON_HOST}`;
const CONFIG_URL = `${AMAZON_ORIGIN}/config.json?skipToken=false&clientApplication=skyfire`;
const WEB_SKILL_BASE = 'https://fe.web.skill.music.a2z.com/api';
const CATALOG_SKILL_BASE = 'https://fe.mesk.skill.music.a2z.com/api';
const OVERALL_CHART_PAGE_URL = `${AMAZON_ORIGIN}/popular/songs/browsePanel/popularTracks`;
const OVERALL_CHART_INITIAL_URL = `${CATALOG_SKILL_BASE}/showChartsWidget?genreTitle=browsePanel&genreId=popularTracks&widgetId=top-songs&userHash=%7B%22level%22%3A%22LIBRARY_MEMBER%22%7D`;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const RETRY_ATTEMPTS = 6;
const TOP_STATE_KEY = 'amazon-music/rank-monitor/top-1000.json';
const DEEP_STATE_KEY = 'amazon-music/rank-monitor/deep-100k.json';
const GROUP_STATE_KEY = 'amazon-music/rank-monitor/sakamichi-ranks.json';

export const AMAZON_MUSIC_TOP_SCAN_RANK = 1_000;
export const AMAZON_MUSIC_DEEP_SCAN_TARGET_RANK = 100_000;
export const AMAZON_MUSIC_DEEP_SCAN_PAGES_PER_RUN = 100;

const GROUP_ALIASES = Object.freeze([
  ['櫻坂46', ['櫻坂46', 'Sakurazaka46', 'Sakurazaka 46']],
  ['日向坂46', ['日向坂46', 'Hinatazaka46', 'Hinatazaka 46']],
  ['乃木坂46', ['乃木坂46', 'Nogizaka46', 'Nogizaka 46']],
]);

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

function amazonHeaders(configuration) {
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
    'x-amzn-page-url': OVERALL_CHART_PAGE_URL,
    'x-amzn-feature-flags': 'hd-supported,uhd-supported',
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
      headers: JSON.stringify({ ...amazonHeaders(configuration), 'x-amzn-page-url': pageUrl }),
    }),
  });
  await responseJson(response, 'Amazon Music /showHome');
}

async function fetchChartPage(fetchImpl, configuration, url) {
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: outerHeaders(),
      body: JSON.stringify({ headers: JSON.stringify(amazonHeaders(configuration)) }),
    });
    if (response.status === 429) {
      await sleep(Math.min(15_000, 1_000 * (2 ** attempt)));
      continue;
    }
    const document = await responseJson(response, 'Amazon Music overall chart');
    if (isErrorOnlyPayload(document)) throw new Error('Amazon Music overall chart returned an error template');
    return document;
  }
  throw new Error('Amazon Music overall chart rate-limit retries exhausted');
}

export async function scanAmazonChart(fetchImpl = fetch, options = {}) {
  const startRank = Math.max(0, Number(options.startRank) || 0);
  const stopRank = Math.max(startRank + 1, Number(options.stopRank) || AMAZON_MUSIC_TOP_SCAN_RANK);
  const maxPages = Math.max(1, Number(options.maxPages) || 100);
  const configuration = await amazonConfig(fetchImpl);
  await primeWebPlayer(fetchImpl, configuration);

  const tracks = [];
  const seenUrls = new Set();
  const seenTrackIds = new Set();
  let url = text(options.startUrl) || OVERALL_CHART_INITIAL_URL;
  let scannedTracks = startRank;
  let pagesScanned = 0;
  let exhausted = false;

  while (scannedTracks < stopRank && pagesScanned < maxPages) {
    if (!url || seenUrls.has(url)) {
      exhausted = true;
      break;
    }
    seenUrls.add(url);
    const document = await fetchChartPage(fetchImpl, configuration, url);
    pagesScanned += 1;
    const fresh = extractAmazonMusicTracks(document).filter((track) => {
      const id = text(track?.amazon_music_id);
      if (!id || seenTrackIds.has(id)) return false;
      seenTrackIds.add(id);
      return true;
    });
    if (!fresh.length) {
      exhausted = true;
      break;
    }
    for (const track of fresh) {
      if (scannedTracks >= stopRank) break;
      scannedTracks += 1;
      tracks.push({ ...track, rank: scannedTracks });
    }
    if (scannedTracks >= stopRank) break;
    const next = nextChartsWidgetUrl(document);
    if (!next || seenUrls.has(next)) {
      exhausted = true;
      url = null;
      break;
    }
    url = next;
  }

  return {
    tracks,
    scanned_tracks: scannedTracks,
    pages_scanned: pagesScanned,
    next_url: scannedTracks >= stopRank || exhausted ? null : url,
    continuation_url: url,
    exhausted,
  };
}

function canonicalGroup(artist) {
  const value = text(artist)?.normalize('NFKC').toLowerCase() || '';
  for (const [group, aliases] of GROUP_ALIASES) {
    if (aliases.some((alias) => value.includes(alias.normalize('NFKC').toLowerCase()))) return group;
  }
  return null;
}

function groupTracks(tracks) {
  return tracks.flatMap((track) => {
    const group = canonicalGroup(track.artist);
    return group ? [{ ...track, group_name: group }] : [];
  });
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
  await r2.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json; charset=utf-8' } });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

function rankSignature(tracks) {
  return tracks.map((track) => `${track.rank}:${track.amazon_music_id}`).join('|');
}

function changedPositions(previous = [], current = []) {
  const prior = new Map(previous.map((track) => [Number(track.rank), text(track.amazon_music_id)]));
  const next = new Map(current.map((track) => [Number(track.rank), text(track.amazon_music_id)]));
  let changed = 0;
  for (let rank = 1; rank <= AMAZON_MUSIC_TOP_SCAN_RANK; rank += 1) {
    if ((prior.get(rank) || null) !== (next.get(rank) || null)) changed += 1;
  }
  return changed;
}

async function saveChartUpdate(db, observedAt, previousHash, currentHash, changedCount) {
  if (!db?.prepare) return false;
  await db.prepare(`INSERT OR IGNORE INTO amazon_music_chart_change_events
    (observed_at, chart_key, previous_hash, current_hash, changed_positions)
    VALUES (?, 'jp-popular-songs', ?, ?, ?)`)
    .bind(observedAt, previousHash, currentHash, changedCount)
    .run();
  return true;
}

async function resolveTrackIds(db, amazonIds) {
  const ids = [...new Set(amazonIds.map(text).filter(Boolean))];
  const result = new Map();
  if (!db?.prepare || !ids.length) return result;
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db.prepare(`SELECT alias_value, track_id FROM sh_track_aliases
      WHERE alias_type='amazon_music_id' AND alias_value IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const row of rows?.results || []) result.set(String(row.alias_value), Number(row.track_id));
  }
  return result;
}

async function saveGroupChanges(db, observedAt, changes) {
  if (!db?.prepare || !changes.length) return 0;
  const trackIds = await resolveTrackIds(db, changes.map((item) => item.amazon_music_id));
  const statements = changes.map((item) => db.prepare(`INSERT OR IGNORE INTO amazon_music_group_rank_history
    (observed_at, group_name, amazon_music_id, track_id, rank, change_type, title, artist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      observedAt,
      item.group_name,
      item.amazon_music_id,
      trackIds.get(item.amazon_music_id) ?? null,
      item.rank ?? null,
      item.change_type,
      item.title ?? null,
      item.artist ?? null,
    ));
  if (typeof db.batch === 'function') await db.batch(statements);
  else for (const statement of statements) await statement.run();
  return statements.length;
}

function groupStateMap(state) {
  const map = new Map();
  for (const item of Array.isArray(state?.tracks) ? state.tracks : []) {
    if (item?.amazon_music_id) map.set(String(item.amazon_music_id), item);
  }
  return map;
}

function diffGroupRanks(previousState, currentTracks, { allowExit = false } = {}) {
  const previous = groupStateMap(previousState);
  const current = new Map(currentTracks.map((item) => [String(item.amazon_music_id), item]));
  const changes = [];
  for (const item of current.values()) {
    const before = previous.get(String(item.amazon_music_id));
    if (!before) {
      changes.push({ ...item, change_type: 'enter' });
    } else if (Number(before.rank) !== Number(item.rank)) {
      changes.push({ ...item, change_type: 'move' });
    }
  }
  if (allowExit) {
    for (const before of previous.values()) {
      if (!current.has(String(before.amazon_music_id))) {
        changes.push({ ...before, rank: null, change_type: 'exit' });
      }
    }
  }
  return changes;
}

export async function monitorAmazonTop1000(env, observedAt = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');
  const scan = await scanAmazonChart(fetchImpl, {
    startRank: 0,
    stopRank: AMAZON_MUSIC_TOP_SCAN_RANK,
    maxPages: 60,
  });
  if (scan.scanned_tracks < AMAZON_MUSIC_TOP_SCAN_RANK) {
    throw new Error(`Amazon top-1000 scan incomplete: ${scan.scanned_tracks}`);
  }

  const previous = await getJson(r2, TOP_STATE_KEY);
  const currentHash = await sha256(rankSignature(scan.tracks));
  const previousHash = text(previous?.hash);
  const updated = Boolean(previousHash && previousHash !== currentHash);
  const changedCount = updated ? changedPositions(previous?.tracks, scan.tracks) : 0;

  if (updated) {
    await saveChartUpdate(env?.MINUTE_DB, observedAt, previousHash, currentHash, changedCount);
  }

  const priorGroups = await getJson(r2, GROUP_STATE_KEY);
  const currentGroups = groupTracks(scan.tracks);
  if (priorGroups) {
    const changes = diffGroupRanks(priorGroups, currentGroups, { allowExit: true });
    if (changes.length) await saveGroupChanges(env?.MINUTE_DB, observedAt, changes);
  }
  await putJson(r2, GROUP_STATE_KEY, { observed_at: observedAt, scope: 'top-1000', tracks: currentGroups });
  await putJson(r2, TOP_STATE_KEY, {
    observed_at: observedAt,
    hash: currentHash,
    tracks: scan.tracks.map(({ rank, amazon_music_id, title, artist }) => ({ rank, amazon_music_id, title, artist })),
  });

  return {
    ok: true,
    scanned_tracks: scan.scanned_tracks,
    pages_scanned: scan.pages_scanned,
    initialized: !previousHash,
    updated,
    changed_positions: changedCount,
    sakamichi_tracks: currentGroups.length,
  };
}

export async function continueAmazon100kScan(env, observedAt = Date.now(), fetchImpl = fetch) {
  const r2 = env?.PAGES_RESPONSE_R2;
  if (!r2?.put) throw new Error('PAGES_RESPONSE_R2 binding is required');
  const previous = await getJson(r2, DEEP_STATE_KEY);
  const startRank = previous?.complete ? 0 : Math.max(0, Number(previous?.scanned_tracks) || 0);
  const startUrl = previous?.complete ? null : text(previous?.next_url);
  const cycle = previous?.complete ? (Number(previous?.cycle) || 0) + 1 : Math.max(1, Number(previous?.cycle) || 1);
  const seen = previous?.complete ? new Map() : groupStateMap({ tracks: previous?.cycle_tracks });

  const scan = await scanAmazonChart(fetchImpl, {
    startRank,
    startUrl,
    stopRank: AMAZON_MUSIC_DEEP_SCAN_TARGET_RANK,
    maxPages: AMAZON_MUSIC_DEEP_SCAN_PAGES_PER_RUN,
  });
  for (const item of groupTracks(scan.tracks)) seen.set(String(item.amazon_music_id), item);

  const complete = scan.scanned_tracks >= AMAZON_MUSIC_DEEP_SCAN_TARGET_RANK || scan.exhausted;
  const cycleTracks = [...seen.values()].sort((a, b) => Number(a.rank) - Number(b.rank));
  const knownState = await getJson(r2, 'amazon-music/rank-monitor/sakamichi-100k-known.json');
  const changes = diffGroupRanks(knownState, cycleTracks, { allowExit: complete && Boolean(knownState) });

  if (knownState && changes.length) await saveGroupChanges(env?.MINUTE_DB, observedAt, changes);
  if (complete) {
    await putJson(r2, 'amazon-music/rank-monitor/sakamichi-100k-known.json', {
      observed_at: observedAt,
      cycle,
      tracks: cycleTracks,
    });
  }

  await putJson(r2, DEEP_STATE_KEY, {
    observed_at: observedAt,
    cycle,
    scanned_tracks: scan.scanned_tracks,
    next_url: complete ? null : scan.continuation_url,
    complete,
    exhausted: scan.exhausted,
    cycle_tracks: cycleTracks,
  });

  return {
    ok: true,
    cycle,
    scanned_tracks: scan.scanned_tracks,
    pages_scanned: scan.pages_scanned,
    complete,
    exhausted: scan.exhausted,
    sakamichi_tracks_seen: cycleTracks.length,
    d1_changes: knownState ? changes.length : 0,
  };
}
