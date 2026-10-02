import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/regional-music.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/regional-music-shell.js', import.meta.url), 'utf8');
const youtubeRuntime = readFileSync(new URL('../public/youtube-music.js', import.meta.url), 'utf8');
const youtubeShell = readFileSync(new URL('../public/youtube-music-shell.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

const rows = [
  ['1', ['spotify', 'apple-music', 'amazon-music', 'youtube-music']],
  ['2', ['genie', 'bugs', 'joox', 'nhaccuatui', 'anghami', 'melon', 'qq_music']],
  ['3', ['netease_cloud_music', 'kugou_music', 'naver_vibe', 'flo', 'yandex_music', 'boomplay']],
  ['4', ['plern', 'fungjai', 'zing_mp3', 'jiosaavn', 'gaana', 'langit_musik']],
];

test('music subscriptions are grouped into global and local source rows', () => {
  assert.match(html, /id="subscriptionSourceTabsTemplate"/);
  assert.match(html, /href="#spotify" data-subscription-group="global">グローバル<\/a>/);
  assert.match(html, /href="#genie" data-subscription-group="local">ローカル<\/a>/);
  assert.match(html, /data-subscription-group-content="global"/);
  assert.match(html, /data-subscription-group-content="local"/);
  for (const [row, services] of rows) {
    const match = html.match(new RegExp(`<div class="dashboard-source-row" data-row="${row}"[\\s\\S]*?<\\/div>`));
    assert.ok(match, `subscription row ${row} must exist`);
    for (const service of services) assert.match(match[0], new RegExp(`data-source="${service}"`));
  }
  assert.match(tabs, /REGIONAL_MUSIC_MODES/);
  assert.match(tabs, /subscriptionSourceTabsTemplate/);
  assert.match(css, /\.dashboard-source-tabs\.is-multiline/);
  assert.match(css, /\.dashboard-subscription-groups/);
  assert.match(css, /:has\(\[data-subscription-group-content="global"\] \.active\)/);
  assert.match(css, /\.dashboard-source-row\[data-row="1"\]/);
});

test('regional service views share the materialized read model endpoint', () => {
  assert.match(runtime, /fetch\('\/api\/regional-music'/);
  assert.match(runtime, /let readModelPromise = null/);
  assert.match(runtime, /item\.service === service/);
  assert.match(shell, /id: 'regionalMusicView'/);
  assert.match(shell, /regionalMusicArtistBody/);
  assert.match(shell, /regionalMusicTrackBody/);
  assert.match(shell, /regionalMusicPlaylistBody/);
  assert.match(build, /'regional-music\.css'/);
});

test('YouTube Music uses the shared R2 read model but renders public metrics in its first-row tab', () => {
  assert.match(tabs, /'youtube-music':[\s\S]*viewId: 'youtubeMusicView'/);
  assert.match(youtubeRuntime, /fetch\('\/api\/regional-music'/);
  assert.match(youtubeRuntime, /const SERVICE = 'youtube_music'/);
  assert.match(youtubeRuntime, /monthly_audience/);
  assert.match(youtubeRuntime, /total_views/);
  assert.match(youtubeRuntime, /payload\.releases/);
  assert.match(youtubeShell, /月間視聴者/);
  assert.match(youtubeShell, /総視聴回数/);
  assert.match(youtubeShell, /youtubeMusicReleaseBody/);
  assert.doesNotMatch(youtubeRuntime, /タブのみ先行追加|専用収集\/read model接続後/);
});

test('dashboard navigation is bundled directly without a lazy loader workaround', () => {
  assert.match(entry, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.doesNotMatch(build, /dashboard-tabs-loader|args\.path === '\.\/dashboard-tabs\.js/);
});
