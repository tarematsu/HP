import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const apple = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');
const amazon = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const commonShell = readFileSync(new URL('../public/music-service-shell.js', import.meta.url), 'utf8');
const commonCss = readFileSync(new URL('../public/music-service-common.css', import.meta.url), 'utf8');
const playlistRuntime = readFileSync(new URL('../public/music-service-playlists.js', import.meta.url), 'utf8');

test('all music subscription tabs share one overview-trend-track-playlist skeleton', () => {
  for (const source of [spotify, apple, amazon]) {
    assert.match(source, /music-service-view/);
    assert.match(source, /musicServiceMeta/);
    assert.match(source, /music-service-summary/);
    assert.match(source, /title: '推移'/);
    assert.match(source, /title: '楽曲'/);
    assert.match(source, /title: 'プレイリスト'/);
    assert.match(source, /musicServiceSection/);
  }
  assert.match(commonShell, /export function musicServiceMeta/);
  assert.match(commonShell, /export function musicServiceSection/);
  assert.match(commonShell, /export function musicServicePlaylistCard/);
});

test('music subscription presentation uses one shared responsive style contract', () => {
  assert.match(commonCss, /\.music-service-view/);
  assert.match(commonCss, /\.music-service-meta/);
  assert.match(commonCss, /\.music-service-summary\.summary-cards/);
  assert.match(commonCss, /\.music-service-section-heading/);
  assert.match(commonCss, /\.music-service-playlist-table/);
  assert.match(commonCss, /@media \(max-width: 760px\)/);
});

test('playlist detail code remains lazy while all three services render into the common section', () => {
  for (const [source, service] of [[spotify, 'spotify'], [amazon, 'amazon']]) {
    assert.match(source, /function playlistModuleUrl\(\)/);
    assert.match(source, /\['\/music-service-playlists\.js', 'v=20261001\.1'\]\.join\('\?'\)/);
    assert.match(source, /import\(playlistModuleUrl\(\)\)/);
    assert.match(source, new RegExp(`loadMusicServicePlaylists\\?\\.\\('${service}'\\)`));
  }
  assert.match(apple, /id="applePlaylistMount"/);
  assert.match(playlistRuntime, /'\/api\/spotify-playlists'/);
  assert.match(playlistRuntime, /'\/api\/amazon-music-playlists'/);
  assert.match(playlistRuntime, /'\/api\/apple-music-playlists'/);
  assert.match(playlistRuntime, /normalizedTracks/);
});
