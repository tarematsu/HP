import {
  REGIONAL_MUSIC_ARTISTS,
  YOUTUBE_MUSIC_ARTISTS,
  regionalMusicService,
} from './regional-music-service-registry.js';

const BACKFILL_LIMIT = 500;
const UPDATE_BATCH_SIZE = 20;
const EXTRA_ARTIST_ALIASES = Object.freeze({
  sakurazaka46: Object.freeze(['사쿠라자카46']),
  nogizaka46: Object.freeze(['노기자카46']),
  hinatazaka46: Object.freeze(['히나타자카46']),
});

// Japanese releases on Chinese services often keep the original title and append
// a Chinese translation, e.g. `17分間 (17分钟)`. A smaller set is published with
// simplified/traditional character substitutions only. Fold those character
// variants before comparing; do not translate words or guess semantically.
const CJK_FOLD = Object.freeze({
  '櫻': '樱', '桜': '樱', '認': '认', '愛': '爱', '歲': '岁', '歳': '岁',
  '間': '间', '記': '记', '憶': '忆', '飛': '飞', '風': '风', '夢': '梦',
  '變': '变', '変': '变', '氣': '气', '気': '气', '樂': '乐', '楽': '乐',
  '歸': '归', '帰': '归', '遠': '远', '後': '后', '時': '时', '聲': '声',
  '願': '愿', '續': '续', '続': '续', '關': '关', '関': '关', '戰': '战',
  '戦': '战', '轉': '转', '還': '还', '過': '过', '來': '来', '選': '选',
  '開': '开', '戀': '恋', '讓': '让', '葉': '叶', '邊': '边', '門': '门',
  '鐘': '钟', '麗': '丽', '龍': '龙', '應': '应', '當': '当', '從': '从',
  '舊': '旧', '區': '区', '帶': '带', '畫': '画', '話': '话', '實': '实',
  '線': '线', '數': '数', '讀': '读', '寫': '写', '體': '体', '國': '国',
  '學': '学', '萬': '万', '與': '与', '無': '无', '見': '见', '覺': '觉',
  '發': '发', '點': '点', '對': '对', '顷': '顷', '頃': '顷', '翅': '翅',
});

const catalogCache = new WeakMap();
const broadCatalogCache = new WeakMap();
const backfillCache = new WeakMap();

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function text(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function foldCjk(value) {
  return [...String(value || '')].map((character) => CJK_FOLD[character] || character).join('');
}

function compactTitle(value) {
  const normalized = text(value)?.normalize('NFKC').toLocaleLowerCase('ja-JP');
  if (!normalized) return null;
  const folded = foldCjk(normalized)
    .replace(/[\p{White_Space}\p{Punctuation}\p{Symbol}]+/gu, '');
  return folded || null;
}

function titleParts(value) {
  const source = text(value)?.normalize('NFKC');
  if (!source) return [];
  const variants = new Set([source]);

  // Keep both the original-title part and the translated annotation. Matching
  // against the original-title part is the important case for Chinese catalogs.
  for (const match of source.matchAll(/[（(【\[《「『]([^）)】\]》」』]+)[）)】\]》」』]/gu)) {
    if (text(match[1])) variants.add(match[1].trim());
  }
  const withoutAnnotations = source
    .replace(/[（(【\[《「『][^）)】\]》」』]+[）)】\]》」』]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutAnnotations) variants.add(withoutAnnotations);

  for (const part of source.split(/\s+(?:[|｜/／·•]|[-–—])\s+/u)) {
    if (text(part)) variants.add(part.trim());
  }
  return [...variants];
}

export function regionalMusicTitleKeys(value) {
  return [...new Set(titleParts(value).map(compactTitle).filter(Boolean))];
}

function candidateMatchScore(providerTitle, candidateTitle) {
  const providerKeys = regionalMusicTitleKeys(providerTitle);
  const candidateKeys = regionalMusicTitleKeys(candidateTitle);
  if (!providerKeys.length || !candidateKeys.length) return 0;
  if (candidateKeys.some((key) => providerKeys.includes(key))) return 100;

  // Only allow containment when the provider explicitly marks a translated or
  // alternate title. This avoids treating ordinary title prefixes as matches.
  const decorated = /[（(【\[《「『）)】\]》」』|｜/／]/u.test(String(providerTitle || ''));
  if (!decorated) return 0;
  const providerFull = compactTitle(providerTitle);
  const contained = candidateKeys.some((key) => key.length >= 2 && providerFull?.includes(key));
  return contained ? 80 : 0;
}

function candidateIdentityScore(candidate) {
  // ISRC is the strongest portable recording identity. Spotify ID is also a
  // high-confidence identity and, in this database, usually marks the enriched
  // canonical row rather than an old Stationhead-only duplicate.
  return (text(candidate?.isrc) ? 4 : 0) + (text(candidate?.spotify_id) ? 2 : 0);
}

export function matchRegionalMusicCanonicalTrack(providerTitle, candidates = []) {
  const matches=[];
  let bestTitleScore=0;
  for (const candidate of candidates || []) {
    const id = positiveInteger(candidate?.id);
    if (id == null) continue;
    const titleScore = candidateMatchScore(providerTitle, candidate?.title);
    if (!titleScore) continue;
    if (titleScore > bestTitleScore) bestTitleScore=titleScore;
    matches.push({candidate,id,titleScore,identityScore:candidateIdentityScore(candidate)});
  }
  const best=matches.filter(row=>row.titleScore===bestTitleScore);
  if (!best.length) return null;
  const ids=new Set(best.map(row=>row.id));
  if (ids.size===1) return best[0].candidate;

  // Duplicate sh_tracks rows are common. Prefer one enriched identity only when
  // it is uniquely stronger; ties stay unresolved rather than guessing.
  const strongest=Math.max(...best.map(row=>row.identityScore));
  if (strongest<=0) return null;
  const preferred=best.filter(row=>row.identityScore===strongest);
  const preferredIds=new Set(preferred.map(row=>row.id));
  return preferredIds.size===1 ? preferred[0].candidate : null;
}

async function rows(db, sql, bindings = []) {
  if (!db?.prepare) return [];
  const statement = bindings.length ? db.prepare(sql).bind(...bindings) : db.prepare(sql);
  if (typeof statement?.all !== 'function') return [];
  const result = await statement.all();
  return Array.isArray(result?.results) ? result.results : [];
}

function cacheFor(cache, env) {
  let value = cache.get(env);
  if (!value) {
    value = new Map();
    cache.set(env, value);
  }
  return value;
}

function artistDefinitions(service) {
  return service === 'youtube_music' ? YOUTUBE_MUSIC_ARTISTS : REGIONAL_MUSIC_ARTISTS;
}

function artistAliases(service, canonicalArtist) {
  const definition = artistDefinitions(service)[canonicalArtist];
  if (!definition) return [];
  return [...new Set([
    definition.displayName,
    ...(definition.aliases || []),
    ...(EXTRA_ARTIST_ALIASES[canonicalArtist] || []),
  ].map(text).filter(Boolean))];
}

async function loadExactCatalog(env, service, canonicalArtist) {
  if (!env?.MINUTE_DB?.prepare) return [];
  const aliases = artistAliases(service, canonicalArtist);
  if (!aliases.length) return [];
  const cache = cacheFor(catalogCache, env);
  const cacheKey = canonicalArtist;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const placeholders = aliases.map(() => '?').join(',');
  const result = await rows(env.MINUTE_DB, `SELECT id,title,artist,isrc,spotify_id
    FROM sh_tracks INDEXED BY idx_sh_tracks_artist_identity
    WHERE title IS NOT NULL AND artist IS NOT NULL
      AND TRIM(artist) COLLATE NOCASE IN (${placeholders})
    ORDER BY id ASC`, aliases);
  cache.set(cacheKey, result);
  return result;
}

async function loadBroadCatalog(env, service, canonicalArtist) {
  if (!env?.MINUTE_DB?.prepare) return [];
  const aliases = artistAliases(service, canonicalArtist);
  if (!aliases.length) return [];
  const cache = cacheFor(broadCatalogCache, env);
  const cacheKey = canonicalArtist;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  // Rare compatibility fallback for collaboration/combined artist strings such
  // as `坂道選抜, 乃木坂46, 櫻坂46, 日向坂46`. Keep the scan off the normal path.
  const predicates=aliases.map(()=>`artist COLLATE NOCASE LIKE ?`).join(' OR ');
  const bindings=aliases.map(alias=>`%${alias}%`);
  const result = await rows(env.MINUTE_DB, `SELECT id,title,artist,isrc,spotify_id
    FROM sh_tracks
    WHERE title IS NOT NULL AND artist IS NOT NULL
      AND (${predicates})
    ORDER BY id ASC`, bindings);
  cache.set(cacheKey, result);
  return result;
}

async function backfillKnownRegionalRows(env, service, canonicalArtist, candidates) {
  if (!env?.OTHER_DB?.prepare || env.REGIONAL_MUSIC_SNAPSHOT_STORE) return;
  const cache = cacheFor(backfillCache, env);
  const cacheKey = `${service}:${canonicalArtist}`;
  if (cache.has(cacheKey)) return;
  cache.set(cacheKey, true);

  const unresolved = await rows(env.OTHER_DB, `SELECT service_track_id,title
    FROM regional_music_tracks
    WHERE service=? AND canonical_artist=? AND canonical_track_id IS NULL
      AND title IS NOT NULL
    ORDER BY last_seen_at DESC
    LIMIT ${BACKFILL_LIMIT}`, [service, canonicalArtist]);
  const updates = [];
  for (const row of unresolved) {
    const match = matchRegionalMusicCanonicalTrack(row?.title, candidates);
    const trackId = positiveInteger(match?.id);
    const sourceTrackId = text(row?.service_track_id);
    if (trackId == null || !sourceTrackId) continue;
    updates.push(env.OTHER_DB.prepare(`UPDATE regional_music_tracks
      SET canonical_track_id=?
      WHERE service=? AND service_track_id=? AND canonical_track_id IS NULL`)
      .bind(trackId, service, sourceTrackId));
  }
  if (!updates.length) return;
  if (typeof env.OTHER_DB.batch === 'function') {
    for (let offset = 0; offset < updates.length; offset += UPDATE_BATCH_SIZE) {
      await env.OTHER_DB.batch(updates.slice(offset, offset + UPDATE_BATCH_SIZE));
    }
    return;
  }
  for (const statement of updates) await statement.run();
}

export async function resolveRegionalMusicCanonicalTrack(env, value = {}) {
  const existingTrackId = positiveInteger(value?.track_id ?? value?.canonical_track_id);
  if (existingTrackId != null) {
    return { ...value, track_id: existingTrackId, canonical_track_id: existingTrackId };
  }
  const service = String(value?.service || '');
  if (!regionalMusicService(service)) return value;
  const canonicalArtist = String(value?.canonical_artist || '');
  if (!artistDefinitions(service)[canonicalArtist] || !text(value?.title)) return value;

  let candidates = await loadExactCatalog(env, service, canonicalArtist);
  let match = matchRegionalMusicCanonicalTrack(value.title, candidates);
  if (!match) {
    const broadCandidates = await loadBroadCatalog(env, service, canonicalArtist);
    if (broadCandidates.length) {
      candidates = broadCandidates;
      match = matchRegionalMusicCanonicalTrack(value.title, candidates);
    }
  }
  if (!candidates.length) return value;
  await backfillKnownRegionalRows(env, service, canonicalArtist, candidates);
  const canonicalTrackId = positiveInteger(match?.id);
  return canonicalTrackId == null
    ? value
    : { ...value, track_id: canonicalTrackId, canonical_track_id: canonicalTrackId };
}
