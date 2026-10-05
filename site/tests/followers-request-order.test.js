import assert from 'node:assert/strict';
import test from 'node:test';
import { loadFollowersView } from '../public/followers.js';

function environment() {
  const updated = { textContent: '' };
  const notice = { textContent: '', classList: { toggle() {} } };
  const pending = [];
  globalThis.document = { getElementById: id => ({ followersUpdatedAt: updated, followersNotice: notice })[id] || null };
  globalThis.fetch = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const complete = (index, timestamp) => pending[index].resolve(new Response(JSON.stringify({ ok: true, rows: [], updated_at: timestamp })));
  return { updated, notice, pending, complete };
}

test('older follower responses cannot replace a newer refresh', async () => {
  const env = environment();
  const first = loadFollowersView({ force: true });
  const second = loadFollowersView({ force: true });
  env.complete(1, 1791205200000);
  await second;
  const latest = env.updated.textContent;
  env.complete(0, 1791201600000);
  await first;
  assert.equal(env.updated.textContent, latest);
});

test('obsolete follower failures preserve the latest view and cache', async () => {
  const env = environment();
  const first = loadFollowersView({ force: true });
  const rejected = assert.rejects(first, /obsolete/);
  const second = loadFollowersView({ force: true });
  env.complete(1, 1791205200000);
  await second;
  const latest = env.updated.textContent;
  const notice = env.notice.textContent;
  env.pending[0].reject(new Error('obsolete'));
  await rejected;
  assert.equal(env.updated.textContent, latest);
  assert.equal(env.notice.textContent, notice);
  await loadFollowersView();
  assert.equal(env.pending.length, 2);
});
