import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWeeklyRankingReadModel } from '../src/weekly-ranking-materializer.js';

test('latest imported week includes weeks without a featured host in the Top 100', () => {
  const rows = [{
    ranking_date: '2026-10-05',
    ranking_type: '週間リーダーボード',
    rank: 41,
    host_name: 'nogizaka46smej',
    host_alias: 'nogizaka46smej',
  }];
  const model = buildWeeklyRankingReadModel(rows, [], [], Date.parse('2026-10-13T00:00:00Z'), '2026-10-12');
  assert.equal(model.source_max_ranking_date, '2026-10-12');
  assert.deepEqual(model.ranking_weeks, ['2026-10-05', '2026-10-12']);
  assert.equal(model.actual_rows.length, 1);
  assert.ok(model.completed_rows.some((row) => row.ranking_date === '2026-10-12'
    && row.host_name === 'nogizaka46smej' && row.synthetic && row.rank == null));
});

test('latest featured week is used when the full-source marker is missing', () => {
  const rows = [{ ranking_date: '2026-10-05', rank: 41, host_name: 'nogizaka46smej' }];
  const model = buildWeeklyRankingReadModel(rows, [], [], 100);
  assert.equal(model.source_max_ranking_date, '2026-10-05');
});
