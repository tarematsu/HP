import { readMinuteHealth } from '../lib/health-minute.js';
import { readOtherHealth } from '../lib/health-other.js';
import { readSakurazakaHealth } from '../lib/health-sakurazaka.js';

const CACHE_MS = 5 * 60 * 1000;
const DEFAULT_STALE_MS = 60 * 60 * 1000;
const MIN_STALE_MS = 5 * 60 * 1000;
const snapshotCountCache = { value: null, expiresAt: 0, pending: null };

function finite(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function enabledFlag(value) {
  return Number(value || 0) === 1;
}

export function healthStaleMs(env = {}) {
  return Math.max(MIN_STALE_MS, finite(env.HEALTH_ALERT_STALE_MS) ?? DEFAULT_STALE_MS);
}

export async function cachedSnapshotCount(db, now = Date.now()) {
  if (snapshotCountCache.value != null && snapshotCountCache.expiresAt > now) return snapshotCountCache.value;
  const row = await db.prepare('SELECT COALESCE(MAX(id),0) AS count FROM sh_minute_facts').first();
  const value = Number(row?.count || 0);
  snapshotCountCache.value = value;
  snapshotCountCache.expiresAt = Date.now() + CACHE_MS;
  return value;
}

export function resetSnapshotCountCache() {
  snapshotCountCache.value = null;
  snapshotCountCache.expiresAt = 0;
  snapshotCountCache.pending = null;
}

async function loadCollectorState(db) {
  const row = await db.prepare(`SELECT last_run_at,last_success_at,last_error_present,updated_at
    FROM sh_collector_read_model WHERE collector_id='cloudflare-worker' LIMIT 1`).first();
  return {
    ...row,
    last_error: row?.last_error_present ? 'present' : null,
    alert_setup_required: false,
    delivery_setup_required: false,
  };
}

export function publicCollectorHealth(state, now, staleAfterMs) {
  const lastRunAt = finite(state?.last_run_at);
  const lastSuccessAt = finite(state?.last_success_at);
  const incidentStartedAt = finite(state?.incident_started_at);
  const lastObservedSuccessAt = finite(state?.last_observed_success_at);
  const lastAlertAt = finite(state?.last_alert_at);
  const referenceAt = lastSuccessAt ?? incidentStartedAt;
  const ageMs = referenceAt == null ? null : Math.max(0, now - referenceAt);
  const stale = ageMs != null && ageMs >= staleAfterMs;
  const incidentOpen = enabledFlag(state?.incident_open);
  const recoveryBaseline = lastObservedSuccessAt ?? incidentStartedAt ?? lastAlertAt;
  const recoveryPending = incidentOpen
    && lastSuccessAt != null
    && recoveryBaseline != null
    && lastSuccessAt > recoveryBaseline;
  const healthy = referenceAt != null && !stale && (!incidentOpen || recoveryPending);
  return {
    ok: healthy,
    last_run_at: lastRunAt,
    last_success_at: lastSuccessAt,
    age_ms: ageMs,
    stale_after_ms: staleAfterMs,
    stale,
    last_error_present: Boolean(state?.last_error),
    alert_setup_required: Boolean(state?.alert_setup_required || state?.delivery_setup_required),
    alert_incident_open: incidentOpen,
    alert_recovery_pending: recoveryPending,
    alert_delivery_pending: String(state?.pending_event_kind || '').trim() || null,
    alert_incident_started_at: incidentStartedAt,
    alert_last_sent_at: finite(state?.last_alert_at),
    alert_last_recovery_at: finite(state?.last_recovery_at),
    alert_last_error_present: Boolean(state?.alert_last_error || state?.pending_last_error),
  };
}

async function readCollectorHealth(env, now) {
  if (!env?.MINUTE_DB?.prepare) throw new Error('MINUTE_DB binding missing');
  const [snapshotCount, state] = await Promise.all([
    cachedSnapshotCount(env.MINUTE_DB, now),
    loadCollectorState(env.MINUTE_DB),
  ]);
  return {
    ...publicCollectorHealth(state, now, healthStaleMs(env)),
    snapshot_count: snapshotCount,
  };
}

export async function readHealth(env, now = Date.now()) {
  const results = await Promise.allSettled([
    readCollectorHealth(env, now),
    readMinuteHealth(env, now),
    readOtherHealth(env, now),
    readSakurazakaHealth(env, now),
  ]);
  const names = ['collector', 'minute', 'runtime', 'sakurazaka46jp'];
  const components = Object.fromEntries(results.map((result, index) => [
    names[index],
    result.status === 'fulfilled'
      ? result.value
      : { ok: false, error: String(result.reason?.message || result.reason || 'health-check-failed') },
  ]));
  return {
    ok: Object.values(components).every((component) => component.ok),
    service: 'stationhead-pages-health',
    services: ['sh-runtime-orchestrator', 'sh-sakurazaka46jp'],
    gateway: 'cloudflare-pages',
    checked_at: now,
    components,
  };
}

export async function onRequest(context) {
  if (context.request.method !== 'GET') {
    return Response.json({ ok: false, error: 'method-not-allowed' }, {
      status: 405,
      headers: { allow: 'GET' },
    });
  }
  const now = Date.now();
  try {
    const payload = await readHealth(context.env, now);
    return Response.json(payload, {
      status: payload.ok ? 200 : 503,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'public_health_check_failed',
      error: String(error?.message || error).slice(0, 500),
    }));
    return Response.json({
      ok: false,
      service: 'stationhead-pages-health',
      gateway: 'cloudflare-pages',
      error: 'health_check_failed',
      checked_at: now,
      components: {},
    }, {
      status: 503,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  }
}
