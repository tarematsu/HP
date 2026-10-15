import assert from 'node:assert/strict';
import test from 'node:test';
import { japanChartSeries } from '../public/spotify-chart-series.js';

test('Japan charts retain individual songs and all four tracked groups without playcount history', () => {
  const rows = [{ chart_date: '2026-10-13', status: 'ok', entries: [
    { id: 'a', title: '曲A', artists: ['sakurazaka46'], rank: 3 },
    { id: 'b', title: '曲B', artists: ['sakurazaka46'], rank: 25 },
    { id: 'c', title: '選抜', artists: ['sakamichi-selection'], rank: 10 },
  ] }];
  assert.equal(japanChartSeries(rows, ['2026-10-13']).length, 3);
  assert.deepEqual(japanChartSeries(rows, ['2026-10-13'], 'sakamichi-selection').map(s => s.title), ['選抜']);
});

test('captured absence is out-of-chart while uncollected dates break chart lines', () => {
  const rows = [{ chart_date: '2026-10-11', status: 'ok', entries: [{ id: 'a', title: '曲A', artists: ['sakurazaka46'], rank: 3 }] },
    { chart_date: '2026-10-13', status: 'ok', entries: [] }];
  const [series] = japanChartSeries(rows, ['2026-10-11', '2026-10-12', '2026-10-13']);
  assert.deepEqual(series.points.map(p => p.rank), [3, null, 201]);
});
