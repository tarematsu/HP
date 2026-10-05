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

test('featured hosts without rank data remain in the legend series', async () => {
  const { normalizeStationheadLeaderboard } = await import('../public/leaderboard-read-model.js');
  const payload = normalizeStationheadLeaderboard({ rows: [
    { ranking_date: '2026-10-05', host_name: 'sakuramankai', rank: 2 },
  ] });
  assert.deepEqual(payload.series.map(series => series.id), ['sakuramankai', 'sakurazaka46jp', 'nogizaka46smej']);
  assert.deepEqual(payload.series.at(-1).points, []);
});

test('chart legend renders a featured host even when it has no rank points', async () => {
  const { createLeaderboardChart } = await import('../public/leaderboard/chart.js');
  const items = [];
  const legend = { replaceChildren() { items.length = 0; }, append(item) { items.push(item); } };
  globalThis.document = {
    getElementById: id => id === 'leaderboardLegend' ? legend : null,
    createElement: () => ({ style: {}, children: [], setAttribute() {}, append(...children) { this.children.push(...children); } }),
  };
  createLeaderboardChart().renderChart({ series: [
    { id: 'nogizaka46smej', label: 'nogizaka46smej', points: [] },
  ] });
  assert.equal(items.length, 1);
  assert.equal(items[0].children[1].textContent, 'nogizaka46smej');
});
