import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { buildWeeklyRankingReadModel } from '../worker/scripts/materialize-weekly-ranking-read-model.mjs';

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

test('weekly leaderboard read model refresh is scheduled once on Tuesday JST after ingestion', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/materialize-weekly-ranking-read-model.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /cron: '37 17 \* \* 1'/);
  assert.match(workflow, /Materialize weekly leaderboard read model/);
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
