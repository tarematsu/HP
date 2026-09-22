import { pagesActionsR2ResponseKey } from './pages-response-r2.js';

export const PAGES_REALTIME_WATCHDOG_INTERVAL_MS = 5 * 60_000;
export const PAGES_REALTIME_STALE_AFTER_MS = 9 * 60_000;
export const PAGES_REALTIME_DISPATCH_COOLDOWN_MS = 10 * 60_000;

const DASHBOARD_OBJECT_KEY = pagesActionsR2ResponseKey('dashboard');
const DISPATCH_MARKER_KEY = 'pages-response/watchdog/dashboard-dispatch.json';
const GITHUB_WORKFLOW_DISPATCH_URL =
  'https://api.github.com/repos/tarematsu/HP/actions/workflows/refresh-pages-realtime.yml/dispatches';

function finiteTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function objectAgeMs(object, now) {
  const uploadedAt = finiteTimestamp(object?.uploaded);
  return uploadedAt === null ? null : Math.max(0, now - uploadedAt);
}

export function pagesRealtimeWatchdogDue(scheduledAt) {
  const timestamp = Number(scheduledAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  const minute = Math.floor(timestamp / 60_000);
  return minute % (PAGES_REALTIME_WATCHDOG_INTERVAL_MS / 60_000) === 0;
}

async function responseDetail(response) {
  try {
    return (await response.text()).replace(/\s+/g, ' ').trim().slice(0, 300);
  } catch {
    return '';
  }
}

export async function runPagesRealtimeReadModelWatchdog(env, options = {}) {
  const scheduledAt = Number(options.scheduledAt) || Date.now();
  if (!pagesRealtimeWatchdogDue(scheduledAt)) {
    return { status: 'not-due' };
  }

  const bucket = env?.PAGES_RESPONSE_R2;
  if (typeof bucket?.head !== 'function') {
    return { status: 'unavailable', reason: 'pages-response-r2-binding-missing' };
  }

  const now = Number(options.now?.() ?? Date.now());
  const dashboard = await bucket.head(DASHBOARD_OBJECT_KEY);
  const dashboardAgeMs = objectAgeMs(dashboard, now);
  if (dashboardAgeMs !== null && dashboardAgeMs < PAGES_REALTIME_STALE_AFTER_MS) {
    return { status: 'fresh', dashboardAgeMs };
  }

  const marker = await bucket.head(DISPATCH_MARKER_KEY);
  const markerAgeMs = objectAgeMs(marker, now);
  if (markerAgeMs !== null && markerAgeMs < PAGES_REALTIME_DISPATCH_COOLDOWN_MS) {
    return {
      status: 'cooldown',
      dashboardAgeMs,
      cooldownRemainingMs: PAGES_REALTIME_DISPATCH_COOLDOWN_MS - markerAgeMs,
    };
  }

  const token = String(
    env?.PAGES_READ_MODEL_DISPATCH_TOKEN || env?.GITHUB_RADAR_DISPATCH_TOKEN || '',
  ).trim();
  if (!token) throw new Error('PAGES_READ_MODEL_DISPATCH_TOKEN is not configured');

  const fetcher = options.fetcher || globalThis.fetch;
  const response = await fetcher(GITHUB_WORKFLOW_DISPATCH_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'sh-buddies-collector/pages-realtime-watchdog',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main' }),
  });
  if (response.status !== 204) {
    const detail = await responseDetail(response);
    throw new Error(
      `Pages realtime workflow dispatch failed: HTTP ${response.status}${detail ? ` ${detail}` : ''}`,
    );
  }

  if (typeof bucket.put === 'function') {
    await bucket.put(DISPATCH_MARKER_KEY, JSON.stringify({
      dispatchedAt: now,
      dashboardAgeMs,
      workflow: 'refresh-pages-realtime.yml',
      ref: 'main',
    }), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { dispatched_at: String(now) },
    });
  }

  console.warn(JSON.stringify({
    event: 'pages_realtime_read_model_watchdog_dispatched',
    dashboard_age_ms: dashboardAgeMs,
    scheduled_at: scheduledAt,
  }));
  return { status: 'dispatched', dashboardAgeMs, dispatchedAt: now };
}

export const PAGES_REALTIME_READ_MODEL_WATCHDOG = Object.freeze({
  dashboard_object_key: DASHBOARD_OBJECT_KEY,
  dispatch_marker_key: DISPATCH_MARKER_KEY,
  interval_ms: PAGES_REALTIME_WATCHDOG_INTERVAL_MS,
  stale_after_ms: PAGES_REALTIME_STALE_AFTER_MS,
  dispatch_cooldown_ms: PAGES_REALTIME_DISPATCH_COOLDOWN_MS,
});
