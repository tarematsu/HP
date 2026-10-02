import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const apple = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');
const amazon = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const commonShell = readFileSync(new URL('../public/music-service-shell.js', import.meta.url), 'utf8');
const commonCss = readFileSync(new URL('../public/music-service-common.css', import.meta.url), 'utf8');
const playlistRuntime = readFileSync(new URL('../public/music-service-playlists.js', import.meta.url), 'utf8');

test('Apple and Amazon keep the shared overview-trend-track-playlist skeleton', () => {
  for (const source of [apple, amazon]) {
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
  assert.match(commonShell, /section-head music-service-section-heading/);
});

test('Spotify uses the compact regional chart layout without summary or playlist sections', () => {
  assert.match(spotify, /music-service-view/);
  assert.match(spotify, /regional-music-view is-chart-compact/);
  assert.match(spotify, /regional-chart-meta spotify-chart-meta/);
  assert.match(spotify, /regional-chart-section/);
  assert.match(spotify, /spotifyTrackSection/);
  assert.doesNotMatch(spotify, /music-service-summary|spotifyPlaylistSection|spotifyPlaylistMount/);
});

test('music subscription presentation reuses canonical panels with one small responsive contract', () => {
  assert.match(commonCss, /\.music-service-meta/);
  assert.match(commonCss, /\.music-service-section/);
  assert.match(commonCss, /\.music-service-panel/);
  assert.match(commonCss, /\.music-service-playlist-table/);
  assert.match(commonCss, /@media \(max-width: 760px\)/);
});

test('playlist detail code remains lazy for services that still expose playlist sections', () => {
  const source = amazon;
  assert.match(source, /function playlistModuleUrl\(\)/);
  assert.match(source, /\['\/music-service-playlists\.js', 'v=20261001\.1'\]\.join\('\?'\)/);
  assert.match(source, /import\(playlistModuleUrl\(\)\)/);
  assert.match(source, /loadMusicServicePlaylists\?\.\('amazon'\)/);
  assert.match(source, /id="amazonPlaylistMount"/);
  assert.match(apple, /id="applePlaylistMount"/);
  assert.doesNotMatch(spotify, /playlistModuleUrl|loadMusicServicePlaylists|spotifyPlaylistMount/);
  assert.match(playlistRuntime, /'\/api\/spotify-playlists'/);
  assert.match(playlistRuntime, /'\/api\/amazon-music-playlists'/);
  assert.match(playlistRuntime, /'\/api\/apple-music-playlists'/);
  assert.match(playlistRuntime, /normalizedTracks/);
  assert.match(playlistRuntime, /dashboardDataCard/);
});
