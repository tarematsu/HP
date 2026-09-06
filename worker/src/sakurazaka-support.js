const OFFICIAL_NEWS_DUE_SQL = `SELECT 1 AS due FROM sh_official_news_announcements
  WHERE scheduled_at IS NOT NULL AND (
    (status='scheduled' AND scheduled_at>=? AND scheduled_at<=?) OR status='active'
  ) LIMIT 1`;

const OFFICIAL_NEWS_CHECK_STATE_SQL = `SELECT last_check_at
  FROM sh_official_news_monitor_state WHERE id='official-news' LIMIT 1`;

const DUE_CACHE_SLOT_MS = 60_000;
const officialNewsDueCaches = new WeakMap();

function positiveMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function nonNegativeMs(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function scheduledTimestamp(controller, fallback) {
  const value = Number(controller?.scheduledTime);
  return Number.isFinite(value) && value >= 0 ? value : fallback ?? Date.now();
}

export async function officialNewsCheckDue(env, now = Date.now()) {
  const db = env?.OTHER_DB;
  if (!db?.prepare) return false;
  const intervalMs = positiveMs(env.OFFICIAL_NEWS_CHECK_INTERVAL_MS, 60 * 60_000);
  try {
    const row = await db.prepare(OFFICIAL_NEWS_CHECK_STATE_SQL).first();
    const lastCheckAt = Number(row?.last_check_at || 0);
    return !lastCheckAt || now - lastCheckAt >= intervalMs;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'sakurazaka_official_news_check_due_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return true;
  }
}

export async function officialNewsProbeDue(env, now = Date.now()) {
  const db = env?.OTHER_DB;
  if (!db?.prepare) return false;
  const slot = Math.floor(now / DUE_CACHE_SLOT_MS);
  const cached = officialNewsDueCaches.get(db);
  if (cached?.slot === slot) return cached.due;
  const earlyMs = nonNegativeMs(env.OFFICIAL_NEWS_EARLY_WINDOW_MS, 0);
  const lateMs = positiveMs(env.OFFICIAL_NEWS_LATE_WINDOW_MS, 90 * 60_000);
  try {
    const row = await db.prepare(OFFICIAL_NEWS_DUE_SQL)
      .bind(now - lateMs, now + earlyMs)
      .first();
    const due = Boolean(row?.due);
    officialNewsDueCaches.set(db, { slot, due });
    return due;
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'sakurazaka_official_news_due_check_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return false;
  }
}
