import { loadReadModelRevisions, readModelRevisionToken } from './read-model-revision.js';

export const HISTORY_READ_MODEL_KEYS = Object.freeze([
  'history:daily', 'history:weekly', 'history:broadcasts', 'host-history:summary',
]);
export const HISTORY_RENDERER_REVISION = 'worker-history-v2';
const WEEKLY_LIVE_REVISION_KEY = 'weekly-ranking';
const TRACK_HISTORY_REVISION_KEY = 'track-history';
function sourceRevisionKeys(keys) {
  const selected = new Set(keys);
  if (selected.has('history:daily') || selected.has('history:weekly')) {
    selected.add(TRACK_HISTORY_REVISION_KEY);
  }
  if (selected.has('history:weekly')) selected.add(WEEKLY_LIVE_REVISION_KEY);
  if (selected.has('host-history:summary')) selected.add('history:broadcasts');
  return [...selected];
}

export function historyRendererRevision(env) {
  return String(env?.HISTORY_READ_MODEL_RENDERER_REVISION || HISTORY_RENDERER_REVISION);
}

export async function loadHistorySourceRevisions(env, now = Date.now(), keys = HISTORY_READ_MODEL_KEYS) {
  const selected = [...new Set(keys)];
  if (selected.some((key) => !HISTORY_READ_MODEL_KEYS.includes(key))) {
    throw new Error('invalid history source revision key');
  }
  const revisions = await loadReadModelRevisions(env?.OTHER_DB, sourceRevisionKeys(selected));
  const renderer = historyRendererRevision(env);
  const day = new Date(now).toISOString().slice(0, 10);
  const tracks = readModelRevisionToken(revisions, TRACK_HISTORY_REVISION_KEY);
  const broadcasts = readModelRevisionToken(revisions, 'history:broadcasts');
  return Object.fromEntries(selected.map((key) => {
    let revision = `${renderer}:${key}:${readModelRevisionToken(revisions, key)}`;
    if (key === 'history:daily' || key === 'history:weekly') revision += `:tracks:${tracks}`;
    if (key === 'history:weekly') revision += `:live:${readModelRevisionToken(revisions, WEEKLY_LIVE_REVISION_KEY)}`;
    if (key === 'host-history:summary') revision += `:broadcasts:${broadcasts}`;
    if (key.startsWith('history:')) revision += `:day:${day}`;
    return [key, revision];
  }));
}
