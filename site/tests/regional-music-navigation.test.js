import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/regional-music.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/regional-music-shell.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

const rows = [
  ['1', ['spotify', 'apple-music', 'amazon-music', 'youtube-music']],
  ['2', ['genie', 'bugs', 'joox', 'nhaccuatui', 'anghami', 'melon', 'qq_music']],
  ['3', ['netease_cloud_music', 'kugou_music', 'naver_vibe', 'flo', 'yandex_music', 'boomplay']],
  ['4', ['plern', 'fungjai', 'zing_mp3', 'jiosaavn', 'gaana', 'langit_musik']],
];

test('music subscriptions use four explicit source rows', () => {
  assert.match(html, /id="subscriptionSourceTabsTemplate"/);
  for (const [row, services] of rows) {
    const match = html.match(new RegExp(`<div class="dashboard-source-row" data-row="${row}"[\\s\\S]*?<\\/div>`));
    assert.ok(match, `subscription row ${row} must exist`);
    for (const service of services) assert.match(match[0], new RegExp(`data-source="${service}"`));
  }
  assert.match(tabs, /REGIONAL_MUSIC_MODES/);
  assert.match(tabs, /subscriptionSourceTabsTemplate/);
  assert.match(css, /\.dashboard-source-tabs\.is-multiline/);
  assert.match(css, /\.dashboard-source-row/);
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

test('dashboard navigation stays outside the initial bundle and uses the current deployment version', () => {
  assert.match(build, /args\.path === '\.\/dashboard-tabs\.js\?v=20260930\.1'/);
  assert.match(build, /path: '\/dashboard-tabs\.js\?v=20261002\.1', external: true/);
});
