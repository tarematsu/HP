import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRanking } from '../functions/lib/history-ranking.js';

const weeks = [
  { ranking_date: '2026-01-26' },
  { ranking_date: '2026-02-09' },
];

const firstSeen = [
  { host_name: 'alpha', host_aliases: 'Alpha', first_ranking_date: '2026-01-26' },
  { host_name: 'beta', host_aliases: 'Beta', first_ranking_date: '2026-02-09' },
];

function dbFor(actualRows) {
  return {
    prepare(sql) {
      const execute = async () => {
        if (sql.includes('GROUP_CONCAT(DISTINCT channel_alias)')) return { results: firstSeen };
        if (sql.includes('SELECT DISTINCT ranking_date')) return { results: weeks };
        if (sql.includes('FROM sh_channel_rankings r')) return { results: actualRows };
        throw new Error(`unexpected SQL: ${sql}`);
      };
      return {
        bind() {
          return { all: execute };
        },
        all: execute,
      };
    },
  };
}

const summaryLoader = async () => ({
  rows: [],
  live_overlay_count: 0,
  latest_live_observed_at: null,
});

function request(params = '') {
  return new URL(`https://example.test/api/history?mode=ranking&from=2026-01-26&to=2026-02-09${params}`);
}

test('all-host scope returns actual leaderboard rows only and summarizes missing host-weeks', async () => {
  const actualRows = [
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 1, host_name: 'alpha' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 2, host_name: 'alpha' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 3, host_name: 'beta' },
  ];
  const response = await loadRanking(request('&scope=all'), { OTHER_DB: dbFor(actualRows) }, summaryLoader);
  const data = await response.json();

  assert.equal(data.scope, 'all');
  assert.equal(data.host_search, '');
  assert.deepEqual(data.chart_hosts, []);
  assert.equal(data.rows.length, 3);
  assert.ok(data.rows.every((row) => !row.synthetic));
  assert.equal(data.ranking_summary.week_count, 3);
  assert.equal(data.ranking_summary.host_count, 2);
  assert.equal(data.ranking_summary.ranked_entry_count, 3);
  assert.equal(data.ranking_summary.out_of_rank_count, 1);
});

test('one searched host gets a chart timeline only from its first leaderboard appearance', async () => {
  const actualRows = [
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 3, host_name: 'beta' },
  ];
  const response = await loadRanking(request('&scope=all&host=beta'), { OTHER_DB: dbFor(actualRows) }, summaryLoader);
  const data = await response.json();

  assert.deepEqual(data.chart_hosts, ['beta']);
  assert.equal(data.host_count, 1);
  assert.deepEqual(data.rows.map((row) => row.ranking_date), ['2026-02-09']);
  assert.equal(data.ranking_summary.out_of_rank_count, 0);
});

test('searched host fills missing weeks after first appearance but never before it', async () => {
  const actualRows = [
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 1, host_name: 'alpha' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 2, host_name: 'alpha' },
  ];
  const response = await loadRanking(request('&scope=all&host=alpha'), { OTHER_DB: dbFor(actualRows) }, summaryLoader);
  const data = await response.json();

  assert.deepEqual(data.chart_hosts, ['alpha']);
  assert.deepEqual(data.rows.map((row) => row.ranking_date), ['2026-02-09', '2026-02-02', '2026-01-26']);
  const missing = data.rows.find((row) => row.ranking_date === '2026-02-02');
  assert.equal(missing.synthetic, true);
  assert.equal(missing.rank, null);
  assert.equal(data.ranking_summary.out_of_rank_count, 1);
});
