import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  WEEKLY_RANKING_MODEL_VERSION,
  buildWeeklyRankingReadModel,
} from '../worker/scripts/materialize-weekly-ranking-read-model.mjs';
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

  assert.equal(model.version, WEEKLY_RANKING_MODEL_VERSION);
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

test('weekly leaderboard producer reads only the three Sakamichi hosts', () => {
  const source = readFileSync(
    new URL('../worker/src/weekly-ranking-materializer.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /lower\(trim\(channel_name\)\) IN \('sakuramankai','sakurazaka46jp','nogizaka46smej'\)/);
  assert.match(source, /lower\(trim\(host_name\)\) IN \('sakuramankai','sakurazaka46jp','nogizaka46smej'\)/);
  assert.match(source, /\['nogizaka46smej', '乃木坂46'\]/);
});

test('weekly leaderboard publication is Worker-owned and uses compact revision materialization', () => {
  const worker = readFileSync(
    new URL('../worker/src/leaderboard-refresh.js', import.meta.url),
    'utf8',
  );
  const gate = readFileSync(
    new URL('../worker/scripts/materialize-weekly-ranking-read-model-if-stale.mjs', import.meta.url),
    'utf8',
  );
  assert.match(worker, /materializeWeeklyRankingReadModel/);
  assert.match(worker, /publishReadModelR2/);
  assert.match(worker, /message\.body\?\.type !== 'stationhead-leaderboard-refresh'/);
  assert.match(worker, /consumeLeaderboardRefresh/);
  assert.doesNotMatch(worker, /wrangler|r2 object put|publish-stationhead-leaderboard-read-model/);
  assert.match(gate, /sh_read_model_revision/);
  assert.match(gate, /sh_weekly_ranking_revision_state/);
  assert.doesNotMatch(gate, /MAX\(imported_at\)|MAX\(verified_at\)/);
  assert.match(gate, /materializeWeeklyRankingReadModel/);
  assert.match(gate, /WEEKLY_RANKING_MODEL_VERSION/);
});

test('weekly leaderboard freshness gate skips current compact revision and rebuilds same-week changes', () => {
  const source = {
    max_ranking_date: '2026-09-21',
    compact_revision: 10,
  };
  const current = {
    source_max_ranking_date: '2026-09-21',
    source_revision: 10,
    refreshed_at: 200,
    model_version: WEEKLY_RANKING_MODEL_VERSION,
    chunk_complete: true,
  };
  assert.equal(sourceRevision(source), '2026-09-21:r10');
  assert.equal(shouldRefreshWeeklyRankingReadModel(source, current), false);
  assert.equal(shouldRefreshWeeklyRankingReadModel({
    ...source,
    compact_revision: 11,
  }, {
    ...current,
    refreshed_at: 999,
  }), true);
  assert.equal(shouldRefreshWeeklyRankingReadModel({
    ...source,
    max_ranking_date: '2026-09-28',
  }, {
    ...current,
    refreshed_at: 999,
  }), true);
  assert.equal(shouldRefreshWeeklyRankingReadModel(source, {
    ...current,
    refreshed_at: 999,
    chunk_complete: false,
  }), true);
  assert.equal(shouldRefreshWeeklyRankingReadModel(source, {
    ...current,
    model_version: WEEKLY_RANKING_MODEL_VERSION - 1,
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
