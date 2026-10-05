import { browserSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const currentShell = readFileSync(new URL('../public/current-shell.js', import.meta.url), 'utf8');
const stationheadShell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const likesShell = browserSource('stationhead-channel-shell.js');
const tabRegistry = browserSource('dashboard-metrics.js');
const staticUi = [stationheadShell, likesShell, tabRegistry].join('\n');
const metrics = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');
const sharedUi = readFileSync(new URL('../public/dashboard-ui-common.js', import.meta.url), 'utf8');
const spotify = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');
const sakurazakaListeningPartyApi = readFileSync(new URL('../functions/api/sakurazaka46jp.js', import.meta.url), 'utf8');
const historyEntry = readFileSync(new URL('../public/history/history-main.js', import.meta.url), 'utf8');
const history = browserSource('history/history-lite.js');
const ranking = readFileSync(new URL('../public/leaderboard-read-model.js', import.meta.url), 'utf8');
const official = readFileSync(new URL('../public/history/history-broadcast-table.js', import.meta.url), 'utf8');
const officialUi = readFileSync(new URL('../public/official-listening-party-ui.js', import.meta.url), 'utf8');
const unofficial = readFileSync(new URL('../public/unofficial-listening-parties.js', import.meta.url), 'utf8');
const likes = browserSource('stationhead/likes.js');

test('shared Stationhead and likes views use explicit user-facing metric names at their source', () => {
  for (const label of ['総再生数', '最終取得', '楽曲数', '楽曲別再生一覧', '最新いいね数', 'リスパ']) assert.match(staticUi, new RegExp(label));
  assert.doesNotMatch(stationheadShell, /合計いいね数|合計いいね数（前日比）|最大いいね数/);
  assert.match(likesShell, /summaryItem\('楽曲数', 'likes-count'\)/);
  assert.match(likesShell, /summaryItem\('最終取得', 'likes-latest'\)/);
  assert.doesNotMatch(likesShell, /likes-summary[^\n]*style=/);
  assert.doesNotMatch(historyEntry, /pages-terminology/);
  assert.doesNotMatch(metrics, /pages-terminology/);
});

test('history and shared leaderboard own their final user-facing terminology', () => {
  for (const label of [
    '取得記録数', 'メンバー数（開始）', 'メンバー数（終了）', 'メンバー増加数', '楽曲数',
    '平均再生数増加量', '平均メンバー増加数', '平均所要時間',
  ]) assert.match(history, new RegExp(label));
  assert.doesNotMatch(history, /relation_label/);
  assert.match(ranking, /\{ key: 'relation', label: '種別' \}/);
  assert.match(ranking, /\{ key: 'channel', label: 'チャンネル' \}/);
  assert.match(ranking, /\{ key: 'artist', label: 'アーティスト名' \}/);
  assert.doesNotMatch(historyEntry, /history-page-fixes|history-table-cleanup|history-summary-average-labels/);
});

test('official and unofficial listening-party tables use event-specific column names', () => {
  for (const label of ['時間帯', '所要時間', '楽曲数', 'イベント名']) assert.match(officialUi, new RegExp(label));
  assert.match(official, /createOfficialPartyHeaderRow/);
  for (const label of ['開始時刻', 'イベント名', '開催チャンネル']) assert.match(unofficial, new RegExp(label));
});

test('likes runtime and CSV use the same likes terminology', () => {
  assert.match(likes, /最新いいね数/);
  assert.match(likes, /'最終取得'/);
  assert.match(likes, /likes-count/);
  assert.doesNotMatch(likes, /likesTotalDelta/);
  assert.doesNotMatch(likes, /likesMaxLikes/);
  assert.doesNotMatch(likes, /metric\('最新いいね'/);
});

test('user-facing wording is stored at its source instead of rewritten during rendering', () => {
  assert.doesNotMatch(sharedUi, /replace\(': ', '：'\)/);
  assert.match(spotify, /Spotify再生数の取得に失敗しました：\$\{error\.message\}/);
  assert.match(sakurazakaListeningPartyApi, /event_name: String\(row\.event_name \|\| '公式リスパ'\)/);
  assert.doesNotMatch(sakurazakaListeningPartyApi, /公式ステヘ/);
});

test('shared Stationhead current view contains no Buddies-only goal card', () => {
  assert.match(currentShell, /mountStationheadChannelShell/);
  assert.match(stationheadShell, /総再生数/);
  assert.doesNotMatch(stationheadShell, /総再生数の目標|metricGoalCompact|streamGoal|goalEta|goal-card|streamCount|goalBar|goalRate/);
});
