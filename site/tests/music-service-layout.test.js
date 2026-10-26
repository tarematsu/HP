import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const spotify = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const apple = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');
const amazon = readFileSync(new URL('../public/amazon-music-shell.js', import.meta.url), 'utf8');
const amazonCss = readFileSync(new URL('../public/amazon-music.css', import.meta.url), 'utf8');
const layoutCss = readFileSync(new URL('../public/pages-layout.css', import.meta.url), 'utf8');
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
    assert.match(source, /musicServiceSection|musicServiceRegionalChartPair/);
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
  assert.doesNotMatch(commonShell, /regional-music\.css|loadRegionalMusicReadModel/i);
});

test('every service owns its own metadata identity and shared cadence contract', () => {
  assert.match(spotify, /meta: \{ valueId: 'spotifyUpdatedAt', cadence: '毎日朝ごろ' \}/);
  assert.match(apple, /meta: \{ valueId: 'appleUpdatedAt', cadence: '毎日6:00' \}/);
  assert.match(amazon, /meta: \{ valueId: 'amazonUpdatedAt', cadence: '毎日5:00開始' \}/);
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
    assert.match(source, /musicServiceTable|musicServiceRankingHistoryTable|musicServiceRegionalChartPair/);
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
  const shared = readFileSync(new URL('../public/dashboard-ui-common.css', import.meta.url), 'utf8');
  assert.match(shared, /:is\(\.music-service-meta, \.regional-chart-meta\)/);
  assert.match(shared, /font-size: var\(--dashboard-small-size\)/);
  assert.doesNotMatch(commonCss, /\.music-service-meta/);
});

test('music-service sub-tabs remain a single horizontally scrollable row', () => {
  assert.match(layoutCss, /\.music-service-view-tabs\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/);
  assert.match(layoutCss, /\.music-service-view-tabs button\s*\{[\s\S]*?flex:\s*0 0 auto;[\s\S]*?min-width:\s*max-content;[\s\S]*?white-space:\s*nowrap;/);
  assert.doesNotMatch(layoutCss, /#spotifyPlaylistsView \.music-service-view-tabs/);
});

test('music service pairs stack at tablet widths and Amazon rank columns remain readable on phones', () => {
  assert.match(layoutCss, /@media \(max-width:900px\)\s*\{\s*\.music-service-group\s*\{\s*grid-template-columns:minmax\(0,1fr\);/);
  assert.match(amazonCss, /\.amazon-rank-col:first-child\s*\{\s*width:\s*72px;/);
  assert.match(amazonCss, /\.amazon-rank-col:nth-child\(2\)\s*\{\s*width:\s*62px;/);
  assert.match(amazonCss, /\.amazon-artist-col\s*\{\s*width:\s*64px;/);
});

test('all service filters use the shared filter primitive', () => {
  for (const source of [spotify, apple, amazon, kkbox, qq, kugou]) {
    assert.match(source, /musicServiceFilterTabs|musicServiceSakamichiFilter|musicServiceRegionalChartPair/);
    assert.doesNotMatch(source, /dashboardModeTabs/);
  }
  assert.match(commonShell, /dashboardModeTabs/);
  assert.match(commonShell, /className: joinClasses\('music-service-filter', className\)/);
});

test('playlist detail stays lazy and renders inside shared sections', () => {
  assert.match(amazon, /import\('\.\/music-service-playlists\.js\?v=20261005\.2'\)/);
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

test('playlist table uses dedicated mobile cards instead of the shared 600px scrolling table', () => {
  assert.match(playlistRuntime, /wrapClassName: 'music-service-playlist-wrap'/);
  assert.doesNotMatch(playlistRuntime, /wrapClassName: 'table-fit-mobile'/);
  assert.match(commonCss, /\.music-service-playlist-table tbody tr\s*\{\s*display: grid;/);
  assert.match(commonCss, /grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(commonCss, /\.music-service-playlist-table tbody td:nth-child\(3\)\s*\{\s*grid-column: 1 \/ -1;/);
  assert.match(commonCss, /\.music-service-playlist-links\s*\{\s*min-width: 0;\s*overflow-wrap: anywhere;/);
});

test('YouTube Music playlist rows use an unclipped single-column mobile layout', () => {
  assert.match(commonCss, /\.youtube-music-view \.music-service-playlist-table tbody tr\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(commonCss, /\.youtube-music-view \.music-service-playlist-table tbody td\s*\{[\s\S]*?min-width: 0;[\s\S]*?width: auto;[\s\S]*?max-width: 100%/);
  assert.match(commonCss, /\.youtube-music-view \.music-service-playlist-table tbody td:nth-child\(2\)::before\s*\{\s*content: '種別 '/);
  assert.match(commonCss, /\.youtube-music-view \.music-service-playlist-table tbody td:nth-child\(3\)::before\s*\{\s*content: '対象曲数 '/);
});


test('YouTube Music desktop and tablet playlist type stays readable in a fixed-layout table', () => {
  assert.match(commonCss, /@media \(min-width: 761px\)\s*\{[\s\S]*?\.youtube-music-view \.music-service-playlist-table :is\(th, td\):nth-child\(2\)\s*\{\s*width: 96px;\s*text-align: left;\s*white-space: nowrap;\s*overflow-wrap: normal;/);
});

test('Apple Music regional rankings retain their wide, scrollable table layout', () => {
  const appleCss = readFileSync(new URL('../public/apple-music.css', import.meta.url), 'utf8');
  assert.match(apple, /className: 'apple-table apple-region-table sticky-first-column'/);
  assert.match(appleCss, /\.apple-region-table\s*\{\s*min-width:\s*820px;\s*table-layout:\s*auto;/);
  assert.match(layoutCss, /\.music-service-group \.table-wrap > table:not\(\.apple-region-table\)\s*\{\s*width:100%;\s*min-width:0;\s*table-layout:fixed;/);
  assert.match(layoutCss, /\.music-service-group \.table-wrap > table\.shared-numeric-table\.apple-region-table\s*\{\s*width:\s*max-content;\s*min-width:\s*820px;\s*table-layout:\s*auto;/);
  assert.match(layoutCss, /@media \(max-width: 640px\)\s*\{\s*\.music-service-group \.table-wrap > table\.shared-numeric-table\.apple-region-table\s*\{\s*min-width:\s*760px;/);
});
