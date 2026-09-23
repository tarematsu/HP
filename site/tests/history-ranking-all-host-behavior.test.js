import assert from 'node:assert/strict';
import test from 'node:test';

import { loadRanking } from '../functions/lib/history-ranking.js';

const rankingWeeks = ['2026-01-26', '2026-02-02', '2026-02-09'];

function hostKey(value) {
  return String(value || '').trim().toLowerCase();
}

function completeRows(actualRows) {
  const firstSeen = new Map();
  const byWeekHost = new Map();
  const hosts = [];
  const seenHosts = new Set();
  for (const row of actualRows) {
    const key = hostKey(row.host_name);
    if (!seenHosts.has(key)) {
      seenHosts.add(key);
      hosts.push(row.host_name);
    }
    const week = String(row.ranking_date);
    if (!firstSeen.has(key) || week < firstSeen.get(key)) firstSeen.set(key, week);
    byWeekHost.set(`${week}\u0000${key}`, row);
  }
  const completed = [];
  for (const host of hosts) {
    const key = hostKey(host);
    for (const week of rankingWeeks) {
      if (week < firstSeen.get(key)) continue;
      completed.push(byWeekHost.get(`${week}\u0000${key}`) || {
        ranking_date: week,
        observed_at: Date.parse(`${week}T00:00:00Z`),
        ranking_type: '週間リーダーボード',
        rank: null,
        host_name: host,
        host_alias: host,
        source_sheet: null,
        quality_score: null,
        quality_flags: 'not_listed',
        synthetic: true,
        is_out_of_rank: true,
      });
    }
  }
  return completed;
}

function dbFor(actualRows) {
  const model = {
    version: 1,
    refreshed_at: 1_790_000_000_000,
    source_max_ranking_date: '2026-02-09',
    ranking_weeks: rankingWeeks,
    actual_rows: actualRows,
    completed_rows: completeRows(actualRows),
    weekly_metrics: [],
  };
  return {
    prepare(sql) {
      assert.match(sql, /FROM sh_weekly_ranking_read_model/);
      return {
        async first() {
          return {
            payload_json: JSON.stringify(model),
            source_max_ranking_date: model.source_max_ranking_date,
            refreshed_at: model.refreshed_at,
          };
        },
      };
    },
  };
}

function request(params = '') {
  return new URL(`https://example.test/api/history?mode=ranking&from=2026-01-26&to=2026-02-09${params}`);
}

test('all-host scope excludes featured Sakurazaka hosts and orders the remaining hosts by ranked weeks', async () => {
  const actualRows = [
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 1, host_name: 'sakuramankai' },
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 2, host_name: 'sakurazaka46jp' },
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 3, host_name: 'alpha' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 5, host_name: 'alpha' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 4, host_name: 'beta' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 6, host_name: 'gamma' },
  ];
  const response = await loadRanking(request('&scope=all'), { OTHER_DB: dbFor(actualRows) });
  const data = await response.json();

  assert.equal(data.scope, 'all');
  assert.equal(data.host_search, '');
  assert.deepEqual(data.chart_hosts, ['alpha']);
  assert.equal(data.rows.length, 4);
  assert.ok(data.rows.every((row) => !['sakuramankai', 'sakurazaka46jp'].includes(row.host_name)));
  assert.deepEqual(data.host_rankings, [
    { position: 1, host_name: 'alpha', ranked_weeks: 2, average_rank: 4, best_rank: 3, worst_rank: 5 },
    { position: 2, host_name: 'beta', ranked_weeks: 1, average_rank: 4, best_rank: 4, worst_rank: 4 },
    { position: 2, host_name: 'gamma', ranked_weeks: 1, average_rank: 6, best_rank: 6, worst_rank: 6 },
  ]);
  assert.equal(data.ranking_summary.week_count, 3);
  assert.equal(data.ranking_summary.host_count, 3);
  assert.equal(data.ranking_summary.ranked_entry_count, 4);
  assert.equal(data.ranking_summary.out_of_rank_count, 1);
  assert.equal(data.read_path, 'weekly-ranking-read-model');
});

test('featured scope still returns the two Sakurazaka hosts', async () => {
  const actualRows = [
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 1, host_name: 'sakuramankai' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 2, host_name: 'sakurazaka46jp' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 3, host_name: 'alpha' },
  ];
  const response = await loadRanking(request('&scope=featured'), { OTHER_DB: dbFor(actualRows) });
  const data = await response.json();
  assert.deepEqual(data.chart_hosts, ['sakuramankai', 'sakurazaka46jp']);
  assert.deepEqual([...new Set(data.rows.map((row) => row.host_name))].sort(), ['sakuramankai', 'sakurazaka46jp']);
});

test('host ranking counts each leaderboard week once even if duplicate rows exist', async () => {
  const actualRows = [
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 5, host_name: 'alpha' },
    { ranking_date: '2026-01-26', ranking_type: '週間リーダーボード', rank: 3, host_name: 'alpha' },
    { ranking_date: '2026-02-09', ranking_type: '週間リーダーボード', rank: 7, host_name: 'alpha' },
  ];
  const response = await loadRanking(request('&scope=all'), { OTHER_DB: dbFor(actualRows) });
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
  const response = await loadRanking(request('&scope=all&host=beta'), { OTHER_DB: dbFor(actualRows) });
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
  const response = await loadRanking(request('&scope=all&host=alpha'), { OTHER_DB: dbFor(actualRows) });
  const data = await response.json();

  assert.deepEqual(data.chart_hosts, ['alpha']);
  assert.deepEqual(data.rows.map((row) => row.ranking_date), ['2026-02-09', '2026-02-02', '2026-01-26']);
  const missing = data.rows.find((row) => row.ranking_date === '2026-02-02');
  assert.equal(missing.synthetic, true);
  assert.equal(missing.rank, null);
  assert.equal(data.ranking_summary.out_of_rank_count, 1);
});
