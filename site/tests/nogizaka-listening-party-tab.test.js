import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { formatNogizakaBroadcastContent } from '../functions/api/nogizaka-listening-party.js';

const shell = readFileSync(new URL('../public/nogizaka-listening-party-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/nogizaka-listening-party.js', import.meta.url), 'utf8');
const partyUi = readFileSync(new URL('../public/official-listening-party-ui.js', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const tabLayout = readFileSync(new URL('../public/pages-tabs-layout.css', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/nogizaka-listening-party.js', import.meta.url), 'utf8');

test('dashboard tabs are capped at six equal-width columns', () => {
  assert.match(tabLayout, /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)\s*!important/);
});

test('Nogizaka tab is mounted immediately before Hinata when available', () => {
  assert.match(shell, /view: 'nogizaka'/);
  assert.match(shell, /label: '乃木坂'/);
  assert.match(shell, /anchorSelectors: \['\[data-view="hinata"\]', '\[data-mode="broadcasts"\]'\]/);
  assert.match(shell, /position: 'beforebegin'/);
  assert.match(tabs, /nogizaka:\s*\{/);
  assert.match(tabs, /ensureLazyShell\('nogizaka'\)/);
  assert.match(tabs, /loadNogizakaListeningPartyView/);
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

test('Nogizaka live view composites the materialized series with only the realtime probe tail', () => {
  assert.match(runtime, /\/api\/nogizaka-listening-party/);
  assert.match(runtime, /MIN_REFRESH_MS = 15_000/);
  assert.match(runtime, /collection_active/);
  assert.match(api, /sh_nogizaka_official_news_announcements/);
  assert.match(api, /FROM sh_official_broadcast_summary/);
  assert.match(api, /FROM sh_official_broadcast_series/);
  assert.match(api, /async function loadLiveProbes/);
  assert.match(api, /if \(event\.status === 'active'\) \{[\s\S]*loadLiveProbes\(env, event\.id, observedAfter\)/);
  assert.match(api, /mergePoints\(basePoints, realtimePoints\)/);
  assert.match(api, /official_broadcast_series\+official_news_live/);
  assert.match(api, /broadcast_content: formatNogizakaBroadcastContent\(event\)/);
  assert.match(api, /event_name: `\$\{day\.replaceAll\('-', ''\)\} \$\{row\.broadcast_content\}`/);
});

test('Nogizaka completed view is read-model-only and never loads probes outside the active branch', () => {
  assert.match(api, /const \[summary, readSeries\] = await Promise\.all/);
  assert.match(api, /let probes = \[\];\s*if \(event\.status === 'active'\)/);
  assert.doesNotMatch(api, /Promise\.all\(\[\s*loadLiveProbes/);
  assert.match(api, /else if \(readSeries\) source = 'official_broadcast_series'/);
  assert.match(api, /const points = live \? mergePoints\(basePoints, realtimePoints\) : basePoints/);
});
