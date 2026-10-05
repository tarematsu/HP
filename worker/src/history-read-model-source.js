import { loadReadModelRevisions, readModelRevisionToken } from './read-model-revision.js';

export const HISTORY_READ_MODEL_KEYS = Object.freeze([
  'history:daily', 'history:weekly', 'history:broadcasts', 'host-history:summary',
]);
export const HISTORY_RENDERER_REVISION = 'worker-history-v2';
const WEEKLY_LIVE_REVISION_KEY = 'weekly-ranking';
const TRACK_HISTORY_REVISION_KEY = 'track-history';
const SOURCE_REVISION_KEYS = Object.freeze([
  ...HISTORY_READ_MODEL_KEYS,
  WEEKLY_LIVE_REVISION_KEY,
  TRACK_HISTORY_REVISION_KEY,
]);

export function historyRendererRevision(env) {
  return String(env?.HISTORY_READ_MODEL_RENDERER_REVISION || HISTORY_RENDERER_REVISION);
}

export async function loadHistorySourceRevisions(env) {
  const revisions = await loadReadModelRevisions(env?.OTHER_DB, SOURCE_REVISION_KEYS);
  const renderer = historyRendererRevision(env);
  const tracks = readModelRevisionToken(revisions, TRACK_HISTORY_REVISION_KEY);
  const broadcasts = readModelRevisionToken(revisions, 'history:broadcasts');
  return Object.fromEntries(HISTORY_READ_MODEL_KEYS.map((key) => {
    let revision = `${renderer}:${key}:${readModelRevisionToken(revisions, key)}`;
    if (key === 'history:daily' || key === 'history:weekly') revision += `:tracks:${tracks}`;
    if (key === 'history:weekly') revision += `:live:${readModelRevisionToken(revisions, WEEKLY_LIVE_REVISION_KEY)}`;
    if (key === 'host-history:summary') revision += `:broadcasts:${broadcasts}`;
    return [key, revision];
  }));
}
