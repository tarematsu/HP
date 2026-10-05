import { loadMaterializedSummary } from '../../site/functions/lib/materialized-history.js';
import { loadBroadcastPayload } from '../../site/functions/api/history.js';
import { loadHostSummary } from '../../site/functions/api/host-history.js';

export async function renderHistoryReadModel(key, env, now = Date.now()) {
  const from = '2024-06-01';
  const to = new Date(now).toISOString().slice(0, 10);
  if (key === 'history:daily' || key === 'history:weekly') {
    const mode = key.slice('history:'.length);
    const readOnlyEnv = Object.create(env);
    readOnlyEnv.HISTORY_READ_MODEL_READ_ONLY = true;
    const summary = await loadMaterializedSummary(readOnlyEnv, mode, from, to, now);
    return { ok: true, mode, from, to, timezone: 'UTC', ...summary };
  }
  if (key === 'history:broadcasts') {
    const payload = await loadBroadcastPayload(env, from, to);
    if (payload.read_model_complete !== true) throw new Error('broadcast history source is incomplete');
    return payload;
  }
  if (key === 'host-history:summary') {
    const summary = await loadHostSummary(env.OTHER_DB);
    return {
      ok: true, mode: 'summary',
      sakurazaka46jp_active_session: summary.activeSession,
      sakurazaka46jp_recent_sessions: summary.recentSessions,
    };
  }
  throw new Error(`unsupported history model: ${key}`);
}
