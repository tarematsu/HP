import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/regional-music.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/regional-music-shell.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');

const regional = [
  ['genie', 'Genie', 2],
  ['bugs', 'Bugs!', 2],
  ['joox', 'JOOX', 2],
  ['nhaccuatui', 'NhacCuaTui', 2],
  ['anghami', 'Anghami', 2],
  ['melon', 'Melon', 2],
  ['qq_music', 'QQ Music', 2],
  ['netease_cloud_music', 'NetEase Cloud Music', 3],
  ['kugou_music', 'Kugou Music', 3],
  ['naver_vibe', 'Naver VIBE', 3],
  ['flo', 'FLO', 3],
  ['yandex_music', 'Yandex Music', 3],
  ['boomplay', 'Boomplay', 3],
  ['plern', 'Plern', 4],
  ['fungjai', 'Fungjai', 4],
  ['zing_mp3', 'Zing MP3', 4],
  ['jiosaavn', 'JioSaavn', 4],
  ['gaana', 'Gaana', 4],
  ['langit_musik', 'Langit Musik', 4],
];

test('music subscriptions use four explicit source rows', () => {
  assert.match(tabs, /id: 'spotify', label: 'Spotify', row: 1/);
  assert.match(tabs, /id: 'apple-music', label: 'Apple Music', row: 1/);
  assert.match(tabs, /id: 'amazon-music', label: 'Amazon Music', row: 1/);
  assert.match(tabs, /id: 'youtube-music', label: 'YouTube Music', row: 1/);
  for (const [id, label, row] of regional) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(tabs, new RegExp(`\\['${id}', '${escaped}', ${row}\\]`));
  }
  assert.match(tabs, /dashboard-source-row/);
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
