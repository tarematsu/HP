import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const apple = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');
const amazon = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const youtube = readFileSync(new URL('../public/youtube-music-shell.js', import.meta.url), 'utf8');
const regional = readFileSync(new URL('../public/regional-music-shell.js', import.meta.url), 'utf8');
const commonShell = readFileSync(new URL('../public/music-service-shell.js', import.meta.url), 'utf8');
const commonCss = readFileSync(new URL('../public/music-service-common.css', import.meta.url), 'utf8');
const playlistRuntime = readFileSync(new URL('../public/music-service-playlists.js', import.meta.url), 'utf8');

test('all music subscription views use the QQ compact shell contract', () => {
  for (const source of [spotify, apple, amazon, youtube, regional]) {
    assert.match(source, /musicServiceMeta/);
    assert.match(source, /musicServiceSection/);
    assert.match(source, /musicServiceViewClassName/);
  }
  assert.match(commonShell, /export function musicServiceViewClassName/);
  assert.match(commonShell, /'regional-music-view', 'is-chart-compact', 'music-service-view'/);
  assert.match(commonShell, /export function musicServiceMeta/);
  assert.match(commonShell, /'regional-chart-meta', 'music-service-meta'/);
  assert.match(commonShell, /export function musicServiceSection/);
  assert.match(commonShell, /'music-service-section', 'regional-chart-section'/);
  assert.match(commonShell, /regional-chart-section-head/);
});

test('QQ metadata order is shared by Spotify Apple Amazon YouTube and regional services', () => {
  assert.match(spotify, /musicServiceMeta\(\{ valueId: 'spotifyUpdatedAt', cadence: '毎日朝ごろ' \}\)/);
  assert.match(apple, /musicServiceMeta\(\{ valueId: 'appleUpdatedAt', cadence: '毎日6:00' \}\)/);
  assert.match(amazon, /musicServiceMeta\(\{ valueId: 'amazonUpdatedAt', cadence: '毎日6:00' \}\)/);
  assert.match(youtube, /musicServiceMeta\(\{ valueId: 'youtubeMusicUpdated', cadence: '毎日0:00' \}\)/);
  assert.match(regional, /id: 'regionalMusicCompactMeta'/);
  assert.match(regional, /valueId: 'regionalMusicChartUpdated'/);
  assert.match(regional, /cadenceId: 'regionalMusicChartCadence'/);
  assert.match(commonShell, /qq_music: '毎週木曜日18:00'/);
  assert.match(commonShell, /kugou_music: '平日11:30 \/ ACG新歌榜: 水曜11:40'/);
  assert.match(commonShell, /return service \? '毎週月曜日0:00' : '-'/);
  assert.doesNotMatch(commonShell, /netease_cloud_music/);
});

test('service shells keep data-specific sections but no longer own overview-card layout', () => {
  for (const source of [spotify, apple, amazon, youtube]) {
    assert.doesNotMatch(source, /dashboardSummary|dashboardSummaryItem|dashboardDataCard|dashboardChartCard/);
  }
  assert.match(spotify, /spotifyOverviewTrendSection/);
  assert.match(apple, /appleTrendSection/);
  assert.match(amazon, /amazonTrendSection/);
  assert.match(youtube, /youtubeMusicArtistSection/);
  assert.match(regional, /qqJapanChartSection/);
  assert.match(regional, /kugouJapanChartSection/);
  assert.doesNotMatch(regional, /melonArtistPopularitySection/);
  assert.doesNotMatch(regional, /regionalMusicGenericHeader|regional-music-summary|regionalMusicHealth/);
});

test('music subscription presentation reuses one small responsive contract', () => {
  assert.match(commonCss, /\.music-service-meta/);
  assert.match(commonCss, /\.music-service-section/);
  assert.match(commonCss, /\.music-service-panel/);
  assert.match(commonCss, /\.music-service-playlist-table/);
  assert.match(commonCss, /@media \(max-width: 760px\)/);
});

test('playlist detail stays lazy and renders directly inside the shared QQ section', () => {
  assert.match(amazon, /function playlistModuleUrl\(\)/);
  assert.match(amazon, /\['\/music-service-playlists\.js', 'v=20261003\.2'\]\.join\('\?'\)/);
  assert.match(amazon, /import\(playlistModuleUrl\(\)\)/);
  assert.match(amazon, /loadMusicServicePlaylists\?\.\('amazon'\)/);
  assert.match(amazon, /id=\"amazonPlaylistMount\"/);
  assert.match(apple, /id=\"applePlaylistMount\"/);
  assert.doesNotMatch(spotify, /playlistModuleUrl|loadMusicServicePlaylists|spotifyPlaylistMount/);
  assert.match(playlistRuntime, /'\/api\/spotify-playlists'/);
  assert.match(playlistRuntime, /'\/api\/amazon-music-playlists'/);
  assert.match(playlistRuntime, /'\/api\/apple-music-playlists'/);
  assert.match(playlistRuntime, /normalizedTracks/);
  assert.match(playlistRuntime, /dashboardTable/);
  assert.doesNotMatch(playlistRuntime, /dashboardDataCard/);
});
