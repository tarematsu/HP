import { dashboardRouterSource } from './helpers/dashboard-source.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatNogizakaBroadcastContent } from '../functions/api/nogizaka-listening-party.js';

const shellWrapper = readFileSync(new URL('../public/nogizaka-listening-party-shell.js', import.meta.url), 'utf8');
const runtimeWrapper = readFileSync(new URL('../public/nogizaka-listening-party.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/stationhead-channel-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/stationhead-channel.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../public/stationhead-channel-read-model.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8') + readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const tabs = dashboardRouterSource();
const api = readFileSync(new URL('../functions/api/nogizaka-listening-party.js', import.meta.url), 'utf8');
const publisher = readFileSync(new URL('../../worker/src/nogizaka-pages-read-model.js', import.meta.url), 'utf8');

test('Nogizaka is a lazy source route mounted through the shared Stationhead shell', () => {
  assert.match(tabs, /nogizaka:\s*\{/);
  assert.match(tabs, /viewId: 'nogizakaListeningPartyView'/);
  assert.match(tabs, /nogizaka-listening-party-shell\.js/);
  assert.match(tabs, /loadNogizakaListeningPartyView/);
  assert.match(tabs, /id: 'nogizaka', label: 'Nogizaka', defaultMode: 'nogizaka'/);
  assert.match(shellWrapper, /mountStationheadChannelShell/);
  assert.match(shellWrapper, /stationheadModel = 'nogizaka'/);
  assert.match(runtimeWrapper, /loadStationheadChannelView/);
});

test('Nogizaka shares all five Stationhead subtab markup but enables only its read-model capability', () => {
  for (const section of ['current', 'history', 'played-tracks', 'likes', 'broadcasts']) {
    assert.match(shell, new RegExp(`data-stationhead-panel=\\"${section}\\"`));
  }
  assert.match(readModel, /function nogizakaModel\(\)/);
  assert.match(readModel, /capabilities: \['broadcasts'\]/);
  assert.match(readModel, /fetchJson\('\/api\/nogizaka-listening-party'/);
  assert.match(runtime, /button\.disabled = !enabled/);
  assert.match(runtime, /button\.setAttribute\('aria-disabled', String\(!enabled\)\)/);
  assert.match(sharedCss, /\.stationhead-subtabs\s*>\s*button:disabled\s*\{[^}]*opacity:\s*\.42/s);
  assert.match(sharedCss, /text-decoration:\s*line-through/);
});

test('Nogizaka listening-party presentation is rendered by the same shared HTML and JS', () => {
  for (const text of ['開催数', '平均同接', '最大同接', '平均時間', 'リスパ一覧', '所要時間', 'イベント名']) assert.match(shell, new RegExp(text));
  for (const [label, token] of [['開催数', 'broadcast-count'], ['平均同接', 'broadcast-average'], ['最大同接', 'broadcast-maximum'], ['平均時間', 'broadcast-duration']]) {
    assert.match(shell, new RegExp(`summaryItem\\('${label}', '${token}'\\)`));
  }
  for (const token of ['broadcast-chart', 'broadcast-tbody']) assert.match(shell, new RegExp(`role\\('${token}'\\)`));
  assert.match(runtime, /function renderBroadcasts\(/);
  assert.match(runtime, /payload\?\.rows/);
  assert.match(runtime, /payload\?\.series/);
  assert.match(runtime, /broadcast-chart-empty/);
  assert.doesNotMatch(runtime, /\/api\/nogizaka-listening-party/);
});

test('Nogizaka listening-party labels are reusable for future Under Live events', () => {
  assert.equal(formatNogizakaBroadcastContent({
    event_name: '「42ndSG アンダーライブ」セットリスト Stationhead リスニングパーティー',
  }), '42nd アンダーライブ セットリスト');
  assert.equal(formatNogizakaBroadcastContent({
    event_name: '「43rdSG アンダーライブ」セットリスト Stationhead リスニングパーティー',
  }), '43rd アンダーライブ セットリスト');
});

test('Nogizaka public API is materialized-read-model-only', () => {
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response\?key=nogizaka-listening-party/);
  assert.doesNotMatch(api, /OTHER_DB|\.prepare\(|sh_nogizaka_official_news_announcements|sh_official_broadcast_/);
  assert.match(readModel, /source: 'nogizaka'/);
});

test('Nogizaka producer builds the listening-party model from bounded D1 read models', () => {
  assert.match(publisher, /HISTORY_LIMIT = 100/);
  assert.match(publisher, /sh_nogizaka_official_news_announcements/);
  assert.match(publisher, /FROM sh_official_broadcast_summary AS s/);
  assert.match(publisher, /FROM sh_official_broadcast_series/);
  assert.match(publisher, /WHERE s\.host_handle='nogizaka46smej'/);
  assert.match(publisher, /ORDER BY s\.started_at DESC/);
  assert.match(publisher, /LIMIT \?`\)\.bind\(HISTORY_LIMIT\)\.all\(\)/);
  assert.doesNotMatch(publisher, /sh_nogizaka_official_news_station_probes/);
  assert.match(publisher, /pagesActionsR2ResponseKey\(NOGIZAKA_LISTENING_PARTY_MODEL_KEY\)/);
  assert.match(publisher, /broadcast_content: formatNogizakaBroadcastContent\(/);
  assert.match(publisher, /rows,/);
  assert.match(publisher, /jstDayKey\(row\.started_at, day\)/);
  assert.match(publisher, /source = readSeries/);
  assert.match(publisher, /refresh_hint_ms: NOGIZAKA_LISTENING_PARTY_CADENCE_SECONDS \* 1000/);
});
