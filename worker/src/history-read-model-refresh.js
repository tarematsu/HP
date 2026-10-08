import { historyPublicationIsComplete, publishHistoryReadModel } from './history-read-model-publication.js';
import { HISTORY_READ_MODEL_KEYS, historyRendererRevision, loadHistorySourceRevisions } from './history-read-model-source.js';
import { renderHistoryReadModel } from './history-read-model-renderer.js';

const MESSAGE_TYPE = 'pages-history-refresh';

function refreshMessage(key, sourceRevision) {
  return { version: 2, type: MESSAGE_TYPE, key, source_revision: sourceRevision };
}

async function sendRefreshMessages(queue, messages) {
  if (!messages.length) return;
  if (typeof queue?.sendBatch === 'function') {
    await queue.sendBatch(messages.map((body) => ({ body })));
    return;
  }
  if (typeof queue?.send !== 'function') throw new Error('history read-model queue binding is missing');
  await Promise.all(messages.map((body) => queue.send(body)));
}

export async function enqueueChangedHistoryModels(env, now = Date.now(), dependencies = {}) {
  const revisions = await (dependencies.loadRevisions || loadHistorySourceRevisions)(env, now);
  const checks = await Promise.all(HISTORY_READ_MODEL_KEYS.map(async (key) => ({
    key,
    revision: revisions[key],
    complete: await historyPublicationIsComplete(env.PAGES_RESPONSE_R2, key, revisions[key]),
  })));
  const changed = checks.filter(({ complete }) => !complete);
  await sendRefreshMessages(env.HISTORY_READ_MODEL_QUEUE, changed.map(({ key, revision }) => refreshMessage(key, revision)));
  return { queued: changed.length, keys: changed.map(({ key }) => key) };
}

export async function refreshHistoryReadModel(env, message, now = Date.now(), dependencies = {}) {
  if (![1, 2].includes(Number(message?.version)) || message?.type !== MESSAGE_TYPE || !HISTORY_READ_MODEL_KEYS.includes(message?.key)) {
    throw new Error('invalid history refresh message');
  }
  const key = message.key;
  const load = dependencies.loadRevisions || loadHistorySourceRevisions;
  const before = await load(env, now);
  const sourceRevision = before[key];
  if (await historyPublicationIsComplete(env.PAGES_RESPONSE_R2, key, sourceRevision)) return { key, status: 'unchanged' };
  const payload = await (dependencies.render || renderHistoryReadModel)(key, env, now);
  if (payload?.ok !== true) throw new Error('history model generation failed');
  if ((await load(env, now))[key] !== sourceRevision) throw new Error('history source changed during generation');
  await publishHistoryReadModel(env.PAGES_RESPONSE_R2, key, payload, {
    now,
    sourceRevision,
    rendererRevision: historyRendererRevision(env),
  });
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
