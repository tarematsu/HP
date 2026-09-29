import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const history = readFileSync(new URL('../public/history/history-lite.js', import.meta.url), 'utf8');
const ranking = readFileSync(new URL('../public/history/history-ranking-all-host-table.js', import.meta.url), 'utf8');
const official = readFileSync(new URL('../public/history/history-broadcast-table.js', import.meta.url), 'utf8');
const unofficial = readFileSync(new URL('../public/unofficial-listening-parties.js', import.meta.url), 'utf8');
const likes = readFileSync(new URL('../public/history/history-likes.js', import.meta.url), 'utf8');

test('current and likes views use explicit user-facing metric names in static markup', () => {
  for (const label of ['累計再生数', '対象楽曲数', '最大いいね数', '最終取得', '楽曲別一覧', '最新いいね数', 'リスパ']) {
    assert.match(html, new RegExp(label));
  }
  assert.doesNotMatch(historyEntry, /pages-terminology/);
  assert.doesNotMatch(metrics, /pages-terminology/);
});

test('history renderer owns final totals, growth, tracks, and ranking terminology', () => {
  for (const label of [
    '取得記録数', 'メンバー数（開始）', 'メンバー数（終了）', 'メンバー増加数', '楽曲数',
    '平均再生増加数', '平均メンバー増加数', '圏外・欠測週数', '圏外・欠測数', '平均所要時間',
  ]) {
    assert.match(history, new RegExp(label));
  }
  assert.match(history, /\['relation_label', '種別'\]/);
  assert.match(ranking, /\['relation_label', '種別'\]/);
  assert.doesNotMatch(historyEntry, /history-page-fixes|history-table-cleanup|history-summary-average-labels/);
});

test('official and unofficial listening-party tables use event-specific column names', () => {
  for (const label of ['時間帯', '所要時間', '楽曲数', 'イベント名']) {
    assert.match(official, new RegExp(label));
  }
  for (const label of ['開始時刻', 'イベント名', '開催チャンネル']) {
    assert.match(unofficial, new RegExp(label));
  }
});

test('likes runtime and CSV use the same likes terminology', () => {
  assert.match(likes, /最新いいね数/);
  assert.match(likes, /'最終取得'/);
  assert.doesNotMatch(likes, /metric\('最新いいね'/);
});

test('legacy standalone goal card is absent from the current view', () => {
  assert.match(html, /<span>累計再生数<\/span>/);
  assert.match(html, /id="metricGoalCompact"/);
  assert.doesNotMatch(html, /累計再生数の目標|goal-card|id="streamCount"|id="goalBar"|id="goalRate"/);
});
