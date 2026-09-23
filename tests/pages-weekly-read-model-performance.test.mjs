import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildWeeklyRankingReadModel } from '../worker/scripts/materialize-weekly-ranking-read-model.mjs';
import {
  shouldRefreshWeeklyRankingReadModel,
  sourceRevision,
} from '../worker/scripts/materialize-weekly-ranking-read-model-if-stale.mjs';

test('weekly leaderboard read model materializes missing weeks and fandom metadata ahead of Pages reads', () => {
  const model = buildWeeklyRankingReadModel([
    {
      ranking_date: '2026-09-07',
      observed_at: 1,
      ranking_type: '週間リーダーボード',
      rank: 10,
      host_name: 'sakuramankai',
      host_alias: 'sakuramankai',
    },
    {
      ranking_date: '2026-09-21',
      observed_at: 2,
      ranking_type: '週間リーダーボード',
      rank: 8,
      host_name: 'sakuramankai',
      host_alias: 'sakuramankai',
    },
  ], [{
    host_name: 'sakuramankai',
    artist_name: '櫻坂46',
    relation_type: 'fandom',
  }], [], 1234);

  assert.deepEqual(model.ranking_weeks, ['2026-09-07', '2026-09-14', '2026-09-21']);
  assert.equal(model.source_max_ranking_date, '2026-09-21');
  assert.equal(model.refreshed_at, 1234);
  assert.equal(model.completed_rows.length, 3);
  const gap = model.completed_rows.find((row) => row.ranking_date === '2026-09-14');
  assert.equal(gap.synthetic, true);
  assert.equal(gap.rank, null);
  assert.equal(gap.fandom_label, '櫻坂46(ファンダム)');
});

test('Pages leaderboard reads only the weekly materialized model', () => {
  const source = readFileSync(
    new URL('../site/functions/lib/history-ranking.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /FROM sh_weekly_ranking_read_model/);
  assert.match(source, /read_path: 'weekly-ranking-read-model'/);
  assert.doesNotMatch(source, /FROM sh_channel_rankings|FROM sh_channel_fandoms|summaryLoader\s*\(/);
});

test('weekly leaderboard read model refresh is chained to the hourly import instead of an independent cron', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/materialize-weekly-ranking-read-model.yml', import.meta.url),
    'utf8',
  );
  const gate = readFileSync(
    new URL('../worker/scripts/materialize-weekly-ranking-read-model-if-stale.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(workflow, /cron:/);
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Stationhead leaderboard probe report/);
  assert.match(workflow, /materialize-weekly-ranking-read-model-if-stale\.mjs/);
  assert.match(gate, /MAX\(imported_at\)/);
  assert.match(gate, /MAX\(updated_at\)/);
  assert.match(gate, /MAX\(verified_at\)/);
  assert.match(gate, /materializeWeeklyRankingReadModel/);
});

test('weekly leaderboard freshness gate skips current sources and rebuilds same-week revisions', () => {
  const source = {
    max_ranking_date: '2026-09-21',
    max_ranking_imported_at: 200,
    max_weekly_summary_updated_at: 180,
    max_fandom_verified_at: 150,
  };
  assert.equal(sourceRevision(source), '2026-09-21:200:180:150');
  assert.equal(shouldRefreshWeeklyRankingReadModel(source, {
    source_max_ranking_date: '2026-09-21',
    refreshed_at: 200,
    chunk_complete: true,
  }), false);
  assert.equal(shouldRefreshWeeklyRankingReadModel({
    ...source,
    max_ranking_imported_at: 201,
  }, {
    source_max_ranking_date: '2026-09-21',
    refreshed_at: 200,
    chunk_complete: true,
  }), true);
  assert.equal(shouldRefreshWeeklyRankingReadModel({
    ...source,
    max_weekly_summary_updated_at: 205,
  }, {
    source_max_ranking_date: '2026-09-21',
    refreshed_at: 200,
    chunk_complete: true,
  }), true);
  assert.equal(shouldRefreshWeeklyRankingReadModel({
    ...source,
    max_ranking_date: '2026-09-28',
  }, {
    source_max_ranking_date: '2026-09-21',
    refreshed_at: 999,
    chunk_complete: true,
  }), true);
  assert.equal(shouldRefreshWeeklyRankingReadModel(source, {
    source_max_ranking_date: '2026-09-21',
    refreshed_at: 999,
    chunk_complete: false,
  }), true);
});

test('official listening-party Pages read path never reconstructs minute series or probes at request time', () => {
  const source = readFileSync(
    new URL('../site/functions/api/sakurazaka46jp.js', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('export async function loadSakurazakaSeriesRows');
  const end = source.indexOf('\nasync function loadSakurazakaSeries', start);
  assert.ok(start >= 0 && end > start);
  const reader = source.slice(start, end);
  assert.doesNotMatch(reader, /minuteDb\.prepare|SAKURAZAKA_MINUTE_SERIES_SQL|SAKURAZAKA_FAILSAFE_SERIES_SQL|sh_official_news_station_probes/);
  assert.match(reader, /historical_summary_only/);
  assert.match(source, /if \(!env\.OTHER_DB\)/);
});
