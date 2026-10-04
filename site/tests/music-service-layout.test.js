import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const apple = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');
const amazon = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const youtube = readFileSync(new URL('../public/youtube-music-shell.js', import.meta.url), 'utf8');
const kkbox = readFileSync(new URL('../public/kkbox-shell.js', import.meta.url), 'utf8');
const qq = readFileSync(new URL('../public/qq-music-shell.js', import.meta.url), 'utf8');
const kugou = readFileSync(new URL('../public/kugou-music-shell.js', import.meta.url), 'utf8');
const commonShell = readFileSync(new URL('../public/music-service-shell.js', import.meta.url), 'utf8');
const commonRuntime = readFileSync(new URL('../public/music-service-runtime-common.js', import.meta.url), 'utf8');
const commonCss = readFileSync(new URL('../public/music-service-common.css', import.meta.url), 'utf8');
const playlistRuntime = readFileSync(new URL('../public/music-service-playlists.js', import.meta.url), 'utf8');

const serviceShells = [spotify, apple, amazon, youtube, kkbox, qq, kugou];

test('all music subscription views mount through one shared shell contract', () => {
  for (const source of serviceShells) {
    assert.match(source, /mountMusicServiceView/);
    assert.match(source, /musicServiceSection/);
    assert.doesNotMatch(source, /mountDashboardShell|dashboardNotice|dashboardTable/);
  }
  assert.match(commonShell, /export function mountMusicServiceView/);
  assert.match(commonShell, /export function musicServiceViewClassName/);
  assert.match(commonShell, /export function musicServiceMeta/);
  assert.match(commonShell, /export function musicServiceNotice/);
  assert.match(commonShell, /export function musicServiceSection/);
  assert.match(commonShell, /export function musicServiceTable/);
  assert.match(commonShell, /export function musicServiceFilterTabs/);
  assert.match(commonShell, /dashboardSectionHead/);
  assert.match(commonShell, /className: 'music-service-section-head'/);
  assert.doesNotMatch(commonShell, /regional/i);
});

test('every service owns its own metadata identity and shared cadence contract', () => {
  assert.match(spotify, /meta: \{ valueId: 'spotifyUpdatedAt', cadence: '毎日朝ごろ' \}/);
  assert.match(apple, /meta: \{ valueId: 'appleUpdatedAt', cadence: '毎日6:00' \}/);
  assert.match(amazon, /meta: \{ valueId: 'amazonUpdatedAt', cadence: '毎日6:00' \}/);
  assert.match(youtube, /meta: \{ valueId: 'youtubeMusicUpdated', cadence: '毎日0:00' \}/);
  assert.match(kkbox, /valueId: 'kkboxUpdatedAt'/);
  assert.match(kkbox, /cadenceId: 'kkboxCadence'/);
  assert.match(qq, /valueId: 'qqMusicUpdatedAt'/);
  assert.match(qq, /cadenceId: 'qqMusicCadence'/);
  assert.match(kugou, /valueId: 'kugouMusicUpdatedAt'/);
  assert.match(kugou, /cadenceId: 'kugouMusicCadence'/);
  assert.match(commonRuntime, /export const MUSIC_SERVICE_CADENCE/);
  assert.match(commonRuntime, /qq_music: '毎週木曜日18:00'/);
  assert.match(commonRuntime, /kugou_music: '平日11:30 \/ ACG新歌榜: 水曜11:40'/);
  assert.doesNotMatch(commonRuntime, /REGIONAL_MUSIC_CADENCE|loadRegionalMusicReadModel/);
});

test('service shells retain only data-specific section definitions', () => {
  for (const source of serviceShells) {
    assert.match(source, /musicServiceTable/);
    assert.doesNotMatch(source, /dashboardSummary|dashboardSummaryItem|dashboardDataCard|dashboardChartCard/);
  }
  assert.match(spotify, /spotifyOverviewTrendSection/);
  assert.match(apple, /appleTrendSection/);
  assert.match(amazon, /amazonTrendSection/);
  assert.match(youtube, /youtubeMusicArtistSection/);
  assert.match(kkbox, /KKBOX 日語チャート グループ別最高順位推移/);
  assert.match(qq, /QQ音乐 日本榜 グループ別最高順位推移/);
  assert.match(kugou, /酷狗音乐 日本榜 グループ別最高順位推移/);
});

test('all music subscription presentation uses one responsive layout contract', () => {
  for (const selector of [
    '.music-service-view.is-chart-compact',
    '.music-service-meta',
    '.music-service-section',
    '.music-service-filter.mode-tabs',
    '.music-service-table :is(th, td)',
    '.music-service-rank-legend',
    '.music-service-rank-chart',
    '.music-service-history-table',
    '.music-service-playlist-table',
  ]) {
    assert.ok(commonCss.includes(selector), selector);
  }
  assert.match(commonCss, /@media \(max-width: 760px\)/);
  assert.doesNotMatch(commonCss, /regional/i);
});

test('all service filters use the shared filter primitive', () => {
  for (const source of [spotify, apple, amazon, kkbox, qq, kugou]) {
    assert.match(source, /musicServiceFilterTabs/);
    assert.doesNotMatch(source, /dashboardModeTabs/);
  }
  assert.match(commonShell, /dashboardModeTabs/);
  assert.match(commonShell, /className: joinClasses\('music-service-filter', className\)/);
});

test('playlist detail stays lazy and renders inside shared sections', () => {
  assert.match(amazon, /function playlistModuleUrl\(\)/);
  assert.match(amazon, /\['\/music-service-playlists\.js', 'v=20261004\.1'\]\.join\('\?'\)/);
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
  assert.match(playlistRuntime, /appendTableRow/);
  assert.match(playlistRuntime, /replaceTableHeader/);
  assert.match(playlistRuntime, /appendEmptyTableRow/);
  assert.doesNotMatch(playlistRuntime, /dashboardDataCard/);
});