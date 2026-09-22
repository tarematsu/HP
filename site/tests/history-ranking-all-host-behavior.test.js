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
  { host_name: 'gamma', host_aliases: 'Gamma', first_ranking_date: '2026-02-09' },
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

test('all-host scope returns actual rows plus host ranking summary ordered by ranked weeks', async () => {
  const actualRows = [
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 1, host_name: 'alpha' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 3, host_name: 'alpha' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 2, host_name: 'beta' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 4, host_name: 'gamma' },
  ];
  const response = await loadRanking(request('&scope=all'), { OTHER_DB: dbFor(actualRows) }, summaryLoader);
  const data = await response.json();

  assert.equal(data.scope, 'all');
  assert.equal(data.host_search, '');
  assert.deepEqual(data.chart_hosts, ['alpha']);
  assert.equal(data.rows.length, 4);
  assert.ok(data.rows.every((row) => !row.synthetic));
  assert.deepEqual(data.host_rankings, [
    { position: 1, host_name: 'alpha', ranked_weeks: 2, average_rank: 2, best_rank: 1, worst_rank: 3 },
    { position: 2, host_name: 'beta', ranked_weeks: 1, average_rank: 2, best_rank: 2, worst_rank: 2 },
    { position: 2, host_name: 'gamma', ranked_weeks: 1, average_rank: 4, best_rank: 4, worst_rank: 4 },
  ]);
  assert.equal(data.ranking_summary.week_count, 3);
  assert.equal(data.ranking_summary.host_count, 3);
  assert.equal(data.ranking_summary.ranked_entry_count, 4);
  assert.equal(data.ranking_summary.out_of_rank_count, 2);
});

test('host ranking counts each leaderboard week once even if duplicate rows exist', async () => {
  const actualRows = [
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 5, host_name: 'alpha' },
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 3, host_name: 'alpha' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 7, host_name: 'alpha' },
  ];
  const response = await loadRanking(request('&scope=all'), { OTHER_DB: dbFor(actualRows) }, summaryLoader);
  const data = await response.json();
  assert.deepEqual(data.host_rankings[0], {
    position: 1,
    host_name: 'alpha',
    ranked_weeks: 2,
    average_rank: 5,
    best_rank: 3,
    worst_rank: 7,
  });
});

test('one searched host gets a chart timeline only from its first leaderboard appearance', async () => {
  const actualRows = [
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 3, host_name: 'beta' },
  ];
  const response = await loadRanking(request('&scope=all&host=beta'), { OTHER_DB: dbFor(actualRows) }, summaryLoader);
  const data = await response.json();

  assert.deepEqual(data.chart_hosts, ['beta']);
  assert.equal(data.host_count, 1);
  assert.equal(data.host_rankings[0].ranked_weeks, 1);
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
