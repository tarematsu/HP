import { currentPeriodKey } from '../../site/functions/lib/period-completeness.js';

export const HISTORY_READ_MODEL_KEYS = Object.freeze([
  'history:daily', 'history:weekly', 'history:broadcasts', 'host-history:summary',
]);
export const HISTORY_RENDERER_REVISION = 'worker-history-v1';
export function historyRendererRevision(env) {
  return String(env?.HISTORY_READ_MODEL_RENDERER_REVISION || HISTORY_RENDERER_REVISION);
}

// Primary-key revision lookup: no COUNT/SUM over historical data on each tick.
export async function loadHistorySourceRevisions(env, now = Date.now()) {
  const result = await env.OTHER_DB.prepare(`SELECT model_key,revision,updated_at
    FROM sh_read_model_revision WHERE model_key IN (?,?,?,?)`)
    .bind(...HISTORY_READ_MODEL_KEYS).all();
  const byKey = new Map((result.results || []).map(row => [row.model_key, `${Number(row.revision) || 0}:${Number(row.updated_at) || 0}`]));
  // Completed-history triggers intentionally omit the in-progress weekly rollup.
  // Observe that one row directly so weekly changes are visible without a scan.
  const week = currentPeriodKey('weekly', now);
  const current = await env.OTHER_DB.prepare('SELECT updated_at FROM sh_weekly_summary WHERE period_key=? LIMIT 1').bind(week).first();
  // Track-count corrections arrive in R2 independently of the summary tables.
  const trackObject = await env.PAGES_RESPONSE_R2?.get?.('track-history-days/v1/index.json');
  const trackIndex = trackObject ? await trackObject.json() : null;
  const tracksRevision = Number(trackIndex?.updated_at) || 0;
  const day = new Date(now).toISOString().slice(0, 10);
  return Object.fromEntries(HISTORY_READ_MODEL_KEYS.map(key => [key,
    `${historyRendererRevision(env)}:${key}:${byKey.get(key) || '0:0'}`
      + (key.startsWith('history:') ? `:${day}` : '')
      + (key === 'history:weekly' ? `:${week}:${Number(current?.updated_at) || 0}` : '')
      + (key === 'history:daily' || key === 'history:weekly' ? `:tracks:${tracksRevision}` : '')
      + (key === 'host-history:summary' ? `:${byKey.get('history:broadcasts') || '0:0'}` : ''),
  ]));
}
