const OFFICIAL_NEWS_ID = 'official-news';

function integer(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function positiveMs(value, fallback, minimum = 1_000) {
  const parsed = integer(value);
  return parsed != null && parsed > 0 ? Math.max(minimum, parsed) : fallback;
}

function age(now, value) {
  const timestamp = integer(value);
  return timestamp == null ? null : Math.max(0, now - timestamp);
}

async function readOfficial(db, now) {
  return db.prepare(`SELECT
      monitor.last_check_at,monitor.last_success_at,monitor.last_error,
      (SELECT COUNT(*) FROM sh_official_news_announcements
        WHERE status='scheduled' AND scheduled_at>=?) AS upcoming_count,
      (SELECT COUNT(*) FROM sh_official_news_announcements
        WHERE status='active') AS active_count
    FROM (SELECT ? AS id) requested
    LEFT JOIN sh_official_news_monitor_state monitor ON monitor.id=requested.id`)
    .bind(now, OFFICIAL_NEWS_ID)
    .first();
}

async function readLatestRaw(db) {
  return db.prepare(`SELECT observed_at,station_id,is_broadcasting
    FROM sh_sakurazaka46jp_main
    ORDER BY observed_at DESC,id DESC LIMIT 1`).first();
}

async function readLatestDerived(db, handle) {
  return db.prepare(`SELECT id,status,station_id,last_observed_at,ended_at
    FROM sh_host_broadcast_sessions
    WHERE source_scope='sakurazaka46jp_solo' AND handle=?
    ORDER BY started_at DESC,id DESC LIMIT 1`).bind(handle).first();
}

export async function readSakurazakaHealth(env, now = Date.now()) {
  if (!env?.OTHER_DB?.prepare) throw new Error('OTHER_DB binding missing');
  const handle = String(env.SOLO_BROADCAST_HANDLE || 'sakurazaka46jp').trim().toLowerCase();
  const [officialResult, rawResult, derivedResult] = await Promise.allSettled([
    readOfficial(env.OTHER_DB, now),
    readLatestRaw(env.OTHER_DB),
    readLatestDerived(env.OTHER_DB, handle),
  ]);
  const official = officialResult.status === 'fulfilled' ? officialResult.value : null;
  const raw = rawResult.status === 'fulfilled' ? rawResult.value : null;
  const derived = derivedResult.status === 'fulfilled' ? derivedResult.value : null;

  const officialStaleMs = positiveMs(env.OFFICIAL_NEWS_STALE_MS, 2 * 60 * 60_000, 30 * 60_000);
  const officialAgeMs = age(now, official?.last_check_at);
  const officialSetupRequired = officialResult.status === 'rejected' || integer(official?.last_check_at) == null;
  const officialStale = officialAgeMs == null || officialAgeMs >= officialStaleMs;
  const officialNews = {
    ok: !officialSetupRequired && !officialStale && !official?.last_error,
    setup_required: officialSetupRequired,
    stale: officialStale,
    stale_after_ms: officialStaleMs,
    age_ms: officialAgeMs,
    last_check_at: integer(official?.last_check_at),
    last_success_at: integer(official?.last_success_at),
    last_error_present: Boolean(official?.last_error),
    upcoming_count: Number(official?.upcoming_count || 0),
    active_count: Number(official?.active_count || 0),
  };

  const derivedStatus = String(derived?.status || 'idle');
  const activeDerived = derivedStatus === 'provisional' || derivedStatus === 'active';
  const requiresFresh = Number(official?.active_count || 0) > 0 || activeDerived;
  const staleAfterMs = positiveMs(env.SAKURAZAKA_RAW_STALE_MS, 3 * 60_000, 60_000);
  const rawAgeMs = age(now, raw?.observed_at);
  const derivedAgeMs = age(now, derived?.last_observed_at);
  const rawStale = requiresFresh && (rawAgeMs == null || rawAgeMs >= staleAfterMs);
  const derivedStale = requiresFresh && (derivedAgeMs == null || derivedAgeMs >= staleAfterMs);
  const rawMaterializer = {
    ok: rawResult.status === 'fulfilled' && derivedResult.status === 'fulfilled'
      && !rawStale && !derivedStale,
    required: requiresFresh,
    stale: rawStale || derivedStale,
    stale_after_ms: staleAfterMs,
    raw_age_ms: rawAgeMs,
    derived_age_ms: derivedAgeMs,
    last_raw_at: integer(raw?.observed_at),
    last_derived_at: integer(derived?.last_observed_at),
    session_id: integer(derived?.id),
    station_id: integer(derived?.station_id ?? raw?.station_id),
    session_status: derivedStatus,
  };

  return {
    ok: officialNews.ok && rawMaterializer.ok,
    official_news: officialNews,
    raw_materializer: rawMaterializer,
  };
}
