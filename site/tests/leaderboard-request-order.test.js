import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLeaderboardView } from '../public/leaderboard.js';
import { formatUpdatedAt } from '../public/leaderboard/format.js';
import { cellText } from '../public/leaderboard/table.js';

function environment() {
  const updated = { textContent: '' };
  const notice = { textContent: '', classList: { toggle() {} } };
  const pending = [];
  globalThis.document = { getElementById: id => ({ leaderboardUpdatedAt: updated, leaderboardNotice: notice })[id] || null };
  globalThis.fetch = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
  const complete = (index, timestamp) => pending[index].resolve(new Response(JSON.stringify({ ok: true, rows: [], materialized_at: timestamp })));
  return { updated, notice, pending, complete };
}

test('a late response cannot overwrite a newer refresh of the same leaderboard', async () => {
  const env = environment();
  const first = loadLeaderboardView({ force: true });
  const second = loadLeaderboardView({ force: true });
  env.complete(1, 1791205200000);
  await second;
  env.complete(0, 1791201600000);
  await first;
  assert.equal(env.updated.textContent, formatUpdatedAt(1791205200000));
});

test('an obsolete request failure preserves the latest display and settled cache', async () => {
  const env = environment();
  const first = loadLeaderboardView({ force: true });
  const rejection = assert.rejects(first, /obsolete/);
  const second = loadLeaderboardView({ force: true });
  env.complete(1, 1791205200000);
  await second;
  const notice = env.notice.textContent;
  env.pending[0].reject(new Error('obsolete'));
  await rejection;
  assert.equal(env.updated.textContent, formatUpdatedAt(1791205200000));
  assert.equal(env.notice.textContent, notice);
  await loadLeaderboardView();
  assert.equal(env.pending.length, 2);
});

test('the table keeps missing and out-of-ranking statuses distinct', () => {
  const column = { key: 'rank', format: 'rank' };
  assert.equal(cellText(column, { rank: 3 }), '3位');
  assert.equal(cellText(column, { rank: null, rank_status: '欠測' }), '欠測');
  assert.equal(cellText(column, { rank: 0, rank_status: '圏外' }), '圏外');
});
