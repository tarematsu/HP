import { isRealIsoDate } from './api-utils.js';
import { SUMMARY_TABLES } from '../../../packages/sh-shared/history-summary-contract.mjs';
import {
  loadMaterializedSummary,
  loadPeriodTrackCounts,
} from '../../../packages/sh-shared/materialized-history-summary.mjs';
import { onRequestGet as publicHistory } from '../api/history.js';

export { loadMaterializedSummary, loadPeriodTrackCounts };

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function todayUtcString(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = String(url.searchParams.get('mode') || 'weekly').trim().toLowerCase();
  if (!Object.hasOwn(SUMMARY_TABLES, mode)) return publicHistory({ request, env });

  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const from = fromParam || '2024-06-01';
  const to = toParam || todayUtcString();
  if ((fromParam && !isRealIsoDate(fromParam)) || (toParam && !isRealIsoDate(toParam))) {
    return json({ ok: false, error: 'from and to must be valid YYYY-MM-DD dates' }, 400);
  }
  if (from > to) return json({ ok: false, error: 'from must not be after to' }, 400);

  try {
    const summary = await loadMaterializedSummary(env, mode, from, to);
    return json({ ok: true, mode, from, to, timezone: 'UTC', ...summary });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'materialized history error' }, 500);
  }
}
