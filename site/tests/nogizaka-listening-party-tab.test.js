import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatNogizakaBroadcastContent } from '../functions/api/nogizaka-listening-party.js';

const shell = readFileSync(new URL('../public/nogizaka-listening-party-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/nogizaka-listening-party.js', import.meta.url), 'utf8');
const partyUi = readFileSync(new URL('../public/official-listening-party-ui.js', import.meta.url), 'utf8');
const stationheadTabs = readFileSync(new URL('../public/stationhead-channel-tabs.js', import.meta.url), 'utf8');
const sharedCss = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/nogizaka-listening-party.js', import.meta.url), 'utf8');
const publisher = readFileSync(new URL('../../worker/src/nogizaka-pages-read-model.js', import.meta.url), 'utf8');

test('Nogizaka tab is mounted immediately before Hinata when available', () => {
  assert.match(shell, /view: 'nogizaka'/);
  assert.match(shell, /label: 'Nogizaka'/);
  assert.match(shell, /anchorSelectors: \['\[data-view="hinata"\]', '\[data-mode="broadcasts"\]'\]/);
  assert.match(shell, /position: 'beforebegin'/);
  assert.match(tabs, /nogizaka:\s*\{/);
  assert.match(tabs, /ensureLazyShell\('nogizaka'\)/);
  assert.match(tabs, /loadNogizakaListeningPartyView/);
});

test('Nogizaka uses the shared five Stationhead subtabs with only listening party enabled', () => {
  for (const pair of [
    ["value: 'current', label: '現在'", '現在'],
    ["value: 'history', label: '過去'", '過去'],
    ["value: 'played-tracks', label: '再生履歴'", '再生履歴'],
    ["value: 'likes', label: 'いいね'", 'いいね'],
    ["value: 'broadcasts', label: 'リスパ'", 'リスパ'],
  ]) {
    assert.match(stationheadTabs, new RegExp(pair[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), pair[1]);
  }
  assert.match(shell, /stationheadChannelTabs/);
  assert.match(shell, /active: 'broadcasts'/);
  assert.match(shell, /enabled: \['broadcasts'\]/);
  assert.match(shell, /unavailableTitle: 'Nogizakaでは未提供'/);
  assert.match(shell, /class="stationhead-channel-panel" data-nogizaka-panel="broadcasts"/);
  assert.match(stationheadTabs, /disabled aria-disabled="true"/);
  assert.match(stationheadTabs, /if \(!requested \|\| requested\.disabled\) return/);
});

test('Unavailable Nogizaka tabs are visibly struck through by the shared Stationhead style', () => {
  assert.match(sharedCss, /\.stationhead-subtabs\s*>\s*button:disabled\s*\{[^}]*opacity:\s*\.42/s);
  assert.match(sharedCss, /\.stationhead-subtabs\s*>\s*button:disabled\s*\{[^}]*text-decoration-line:\s*line-through/s);
  assert.match(sharedCss, /\.stationhead-subtabs\s*\{[^}]*grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/s);
});

test('Nogizaka tab keeps the shared official listening-party presentation', () => {
  for (const text of ['期間数', '平均同接', '最大同接', '所要時間', '公式リスパ一覧']) {
    assert.match(shell, new RegExp(text));
  }
  for (const header of ['日付', '時間帯', '所要時間', '平均同接', '最小同接', '最大同接', '楽曲数', '推定再生数', '放送内容', 'イベント名', '出典']) {
    assert.match(partyUi, new RegExp(`'${header}'`));
  }
  assert.match(runtime, /official-listening-party-ui\.js\?v=20261001\.1/);
  assert.match(runtime, /createOfficialPartyHeaderRow\(\)/);
  assert.match(runtime, /createOfficialPartyDataRow\(values, row\.source_url\)/);
  assert.match(runtime, /officialPartyNumberText\(row\?\.listener_avg, decimal\)/);
  assert.match(runtime, /splitOfficialEventName\(row\?\.event_name/);
  assert.match(runtime, /durationLabel\(durationMinutes\(payload\)\)/);
  assert.doesNotMatch(runtime, /function numberText|function durationLabel|function splitEvent|createOfficialSourceCell/);
  assert.match(runtime, /nogizakaPartyChart/);
  assert.match(runtime, /nogizakaPartyCsv/);
});

test('Nogizaka chart keeps an explicit CSS height so redraws cannot grow the canvas', () => {
  assert.match(shell, /id="nogizakaPartyChart"[^>]*style="height:20em"/);
});

test('Nogizaka listening-party labels are reusable for future Under Live events', () => {
  assert.equal(formatNogizakaBroadcastContent({
    event_name: '「42ndSG アンダーライブ」セットリスト Stationhead リスニングパーティー',
  }), '42nd アンダーライブ セットリスト');
  assert.equal(formatNogizakaBroadcastContent({
    event_name: '「43rdSG アンダーライブ」セットリスト Stationhead リスニングパーティー',
  }), '43rd アンダーライブ セットリスト');
});

test('Nogizaka public API is read-model-only and the active tab loads after source-tab navigation', () => {
  assert.match(runtime, /\/api\/nogizaka-listening-party/);
  assert.match(runtime, /MIN_REFRESH_MS = 15_000/);
  assert.match(runtime, /const active = \(\) => byId\('nogizakaListeningPartyView'\)\?\.hidden === false/);
  assert.doesNotMatch(runtime, /#modeTabs button\.active\[data-view="nogizaka"\]/);
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response\?key=nogizaka-listening-party/);
  assert.doesNotMatch(api, /OTHER_DB|\.prepare\(|sh_nogizaka_official_news_announcements|sh_official_broadcast_/);
});

test('Nogizaka producer builds the listening-party model from bounded D1 read models', () => {
  assert.match(publisher, /sh_nogizaka_official_news_announcements/);
  assert.match(publisher, /FROM sh_official_broadcast_summary/);
  assert.match(publisher, /FROM sh_official_broadcast_series/);
  assert.doesNotMatch(publisher, /sh_nogizaka_official_news_station_probes/);
  assert.match(publisher, /pagesActionsR2ResponseKey\(NOGIZAKA_LISTENING_PARTY_MODEL_KEY\)/);
  assert.match(publisher, /broadcast_content: formatNogizakaBroadcastContent\(event\)/);
  assert.match(publisher, /event_name: `\$\{day\.replaceAll\('-', ''\)\} \$\{row\.broadcast_content\}`/);
  assert.match(publisher, /source = readSeries/);
  assert.match(publisher, /refresh_hint_ms: NOGIZAKA_LISTENING_PARTY_CADENCE_SECONDS \* 1000/);
});
