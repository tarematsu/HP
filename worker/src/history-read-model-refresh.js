import { pagesActionsR2ResponseKey } from './pages-response-r2.js';
import { HISTORY_READ_MODEL_KEYS, historyRendererRevision, loadHistorySourceRevisions } from './history-read-model-source.js';
import { historyPublicationIsComplete, publishHistoryEnvelope, seedHistoryRawResponse } from './history-read-model-publication.js';
import { renderHistoryReadModel } from './history-read-model-renderer.js';

const MESSAGE_TYPE = 'pages-history-refresh';

export async function enqueueChangedHistoryModels(env, now = Date.now(), dependencies = {}) {
  const revisions = await (dependencies.loadRevisions || loadHistorySourceRevisions)(env, now);
  const changed = [];
  for (const key of HISTORY_READ_MODEL_KEYS) {
    if (await historyPublicationIsComplete(env.PAGES_RESPONSE_R2, key, revisions[key])) continue;
    await env.HISTORY_READ_MODEL_QUEUE.send({ version: 1, type: MESSAGE_TYPE, key });
    changed.push(key);
  }
  return { queued: changed.length, keys: changed };
}

export async function refreshHistoryReadModel(env, message, now = Date.now(), dependencies = {}) {
  if (message?.version !== 1 || message?.type !== MESSAGE_TYPE || !HISTORY_READ_MODEL_KEYS.includes(message?.key)) throw new Error('invalid history refresh message');
  const key = message.key;
  const load = dependencies.loadRevisions || loadHistorySourceRevisions;
  const sourceRevision = (await load(env, now))[key];
  if (await historyPublicationIsComplete(env.PAGES_RESPONSE_R2, key, sourceRevision)) return { key, status: 'unchanged' };
  const existing = await env.PAGES_RESPONSE_R2.get(pagesActionsR2ResponseKey(key));
  if (existing?.customMetadata?.historySourceRevision === sourceRevision) {
    await seedHistoryRawResponse(env.PAGES_RESPONSE_R2, key, await existing.json(), existing.etag);
    return { key, status: 'raw-repaired' };
  }
  const payload = await (dependencies.render || renderHistoryReadModel)(key, env, now);
  if (payload?.ok !== true) throw new Error('history model generation failed');
  // Do not mark a model current if its source changed during generation.
  if ((await load(env, now))[key] !== sourceRevision) throw new Error('history source changed during generation');
  await publishHistoryEnvelope(env.PAGES_RESPONSE_R2, key, {
    producer: 'worker', version: 1, status: 200, updated_at: now, cadence_seconds: 0,
    source_revision: sourceRevision, renderer_revision: historyRendererRevision(env),
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=30, s-maxage=60' },
    body: JSON.stringify(payload),
  }, sourceRevision);
  return { key, status: 'published' };
}

export async function consumeHistoryRefresh(batch, env, refresh = refreshHistoryReadModel) {
  for (const message of batch.messages) {
    try {
      const result = await refresh(env, message.body);
      if (result.status !== 'unchanged') console.log(JSON.stringify({ event: MESSAGE_TYPE, ...result }));
      message.ack();
    } catch (error) {
      console.error('pages-history-refresh-failed', { error: String(error?.message || error) });
      message.retry();
    }
  }
}
