import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('../public/nogizaka-listening-party-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/nogizaka-listening-party.js', import.meta.url), 'utf8');
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

test('Nogizaka tab keeps the official listening-party presentation', () => {
  for (const text of ['期間数', '平均同接', '最大同接', '所要時間', '公式リスパ一覧']) {
    assert.match(shell, new RegExp(text));
  }
  for (const header of ['日付', '時間帯', '所要時間', '平均同接', '最小同接', '最大同接', '楽曲数', '推定再生数', '放送内容', 'イベント名', '出典']) {
    assert.match(runtime, new RegExp(`'${header}'`));
  }
  assert.match(runtime, /nogizakaPartyChart/);
  assert.match(runtime, /nogizakaPartyCsv/);
});

test('Nogizaka live view reads the official-news probes and refreshes while open', () => {
  assert.match(runtime, /\/api\/nogizaka-listening-party/);
  assert.match(runtime, /MIN_REFRESH_MS = 15_000/);
  assert.match(runtime, /collection_active/);
  assert.match(api, /sh_nogizaka_official_news_announcements/);
  assert.match(api, /sh_nogizaka_official_news_station_probes/);
  assert.match(api, /host_handle='nogizaka46smej'/);
  assert.match(api, /listener_avg/);
  assert.match(api, /listener_min/);
  assert.match(api, /listener_max/);
  assert.match(api, /series:/);
});
