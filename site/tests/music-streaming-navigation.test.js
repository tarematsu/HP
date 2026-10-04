import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const commonRuntime = readFileSync(new URL('../public/music-service-runtime-common.js', import.meta.url), 'utf8');
const kkboxRuntime = readFileSync(new URL('../public/kkbox.js', import.meta.url), 'utf8');
const qqRuntime = readFileSync(new URL('../public/qq-music.js', import.meta.url), 'utf8');
const kugouRuntime = readFileSync(new URL('../public/kugou-music.js', import.meta.url), 'utf8');
const youtubeRuntime = readFileSync(new URL('../public/youtube-music.js', import.meta.url), 'utf8');
const kkboxShell = readFileSync(new URL('../public/kkbox-shell.js', import.meta.url), 'utf8');
const qqShell = readFileSync(new URL('../public/qq-music-shell.js', import.meta.url), 'utf8');
const kugouShell = readFileSync(new URL('../public/kugou-music-shell.js', import.meta.url), 'utf8');
const youtubeShell = readFileSync(new URL('../public/youtube-music-shell.js', import.meta.url), 'utf8');
const readModelProxy = readFileSync(new URL('../functions/lib/music-service-read-model.js', import.meta.url), 'utf8');
const kkboxApi = readFileSync(new URL('../functions/api/kkbox.js', import.meta.url), 'utf8');
const qqApi = readFileSync(new URL('../functions/api/qq-music.js', import.meta.url), 'utf8');
const kugouApi = readFileSync(new URL('../functions/api/kugou-music.js', import.meta.url), 'utf8');
const youtubeApi = readFileSync(new URL('../functions/api/youtube-music.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const musicCss = readFileSync(new URL('../public/music-service-common.css', import.meta.url), 'utf8');
const build = readFileSync(new URL('../scripts/build-public-assets.mjs', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../public/dashboard-metrics.js', import.meta.url), 'utf8');

const visibleSubscriptionServices = [
  'spotify',
  'apple-music',
  'amazon-music',
  'youtube-music',
  'kkbox',
  'qq_music',
  'kugou_music',
];

const removedServices = [
  'genie', 'bugs', 'joox', 'nhaccuatui', 'anghami', 'melon', 'netease_cloud_music',
  'naver_vibe', 'flo', 'yandex_music', 'boomplay', 'plern', 'fungjai', 'zing_mp3',
  'jiosaavn', 'gaana', 'langit_musik',
];

function quotedServicePattern(service) {
  return new RegExp(`['\\"]${service}['\\"]`);
}

test('music streaming navigation exposes one flat service registry', () => {
  assert.doesNotMatch(html, /subscriptionSourceTabsTemplate|dashboard-source-row/);
  assert.match(tabs, /id: 'subscriptions'/);
  for (const service of visibleSubscriptionServices) assert.match(tabs, quotedServicePattern(service));
  for (const service of removedServices) assert.doesNotMatch(tabs, quotedServicePattern(service));
  assert.match(tabs, /id: 'qq_music', label: '🇨🇳QQ音乐'/);
  assert.match(tabs, /id: 'kugou_music', label: '🇨🇳酷狗音乐'/);
  assert.match(css, /\.dashboard-source-tabs\.is-multiline/);
  assert.doesNotMatch(css, /\.dashboard-source-row/);
});

test('KKBOX QQ and Kugou are first-class lazy views like Spotify', () => {
  const configs = [
    ['kkbox', 'kkboxView', 'kkbox-shell.js', 'kkbox.js', 'loadKkboxView'],
    ['qq_music', 'qqMusicView', 'qq-music-shell.js', 'qq-music.js', 'loadQqMusicView'],
    ['kugou_music', 'kugouMusicView', 'kugou-music-shell.js', 'kugou-music.js', 'loadKugouMusicView'],
  ];
  for (const [mode, viewId, shell, runtime, loadExport] of configs) {
    assert.match(tabs, new RegExp(`${mode}: \\{[\\s\\S]*viewId: '${viewId}'[\\s\\S]*${shell.replace('.', '\\.')}`));
    assert.match(tabs, new RegExp(runtime.replace('.', '\\.')));
    assert.match(tabs, new RegExp(`loadExport: '${loadExport}'`));
  }
  assert.match(tabs, /const VIEW_MODES = new Set\(\['current', \.\.\.HISTORY_MODES, \.\.\.Object\.keys\(LAZY_VIEWS\)\]\)/);
  assert.doesNotMatch(tabs, /REGIONAL_MUSIC|showRegionalMusicView|regionalMusicView|regional-music/);
});

test('each streaming service has a direct public API contract', () => {
  assert.match(commonRuntime, /youtube_music: '\/api\/youtube-music'/);
  assert.match(commonRuntime, /kkbox: '\/api\/kkbox'/);
  assert.match(commonRuntime, /qq_music: '\/api\/qq-music'/);
  assert.match(commonRuntime, /kugou_music: '\/api\/kugou-music'/);
  assert.match(commonRuntime, /export function loadMusicServiceReadModel/);
  assert.doesNotMatch(commonRuntime, /loadRegionalMusicReadModel|\/api\/regional-music/);
  assert.match(kkboxApi, /musicServiceReadModelResponse\(env, 'kkbox'\)/);
  assert.match(qqApi, /musicServiceReadModelResponse\(env, 'qq_music'\)/);
  assert.match(kugouApi, /musicServiceReadModelResponse\(env, 'kugou_music'\)/);
  assert.match(youtubeApi, /musicServiceReadModelResponse\(env, 'youtube_music'\)/);
  assert.match(readModelProxy, /music-service:\$\{serviceId\}/);
  assert.match(readModelProxy, /read-only migration fallback/);
});

test('KKBOX owns its shell runtime filters and charts', () => {
  assert.match(kkboxShell, /viewId: 'kkboxView'/);
  assert.match(kkboxShell, /KKBOX 日語チャート グループ別最高順位推移/);
  assert.match(kkboxShell, /KKBOX 日語チャート ランクイン履歴/);
  assert.match(kkboxRuntime, /loadMusicServiceReadModel\(SERVICE\)/);
  assert.match(kkboxRuntime, /activeTerritory/);
  assert.match(kkboxRuntime, /activePeriodType/);
  assert.match(kkboxRuntime, /activeChartType/);
  assert.match(kkboxRuntime, /renderRankHistoryChart/);
  assert.doesNotMatch(kkboxRuntime, /hashchange|popstate|regional/i);
});

test('QQ owns Japan anime and popularity presentation', () => {
  assert.match(qqShell, /viewId: 'qqMusicView'/);
  assert.match(qqShell, /QQ音乐 日本榜 グループ別最高順位推移/);
  assert.match(qqShell, /QQ音乐 动漫音乐榜 グループ別最高順位推移/);
  assert.match(qqShell, /QQ音乐 アーティスト別人気曲順位/);
  assert.match(qqRuntime, /loadMusicServiceReadModel\(SERVICE\)/);
  assert.match(qqRuntime, /activeArtistFilter/);
  assert.match(qqRuntime, /renderRankHistoryChart/);
  assert.match(qqRuntime, /appendTableRow/);
  assert.doesNotMatch(qqRuntime, /hashchange|popstate|regional/i);
});

test('Kugou owns Japan and ACG chart history', () => {
  assert.match(kugouShell, /viewId: 'kugouMusicView'/);
  assert.match(kugouShell, /酷狗音乐 日本榜 グループ別最高順位推移/);
  assert.match(kugouShell, /酷狗音乐 ACG新歌榜 グループ別最高順位推移/);
  assert.match(kugouRuntime, /payload\?\.kugou_japan_chart/);
  assert.match(kugouRuntime, /payload\?\.kugou_acg_chart/);
  assert.match(kugouRuntime, /loadMusicServiceReadModel\(SERVICE\)/);
  assert.match(kugouRuntime, /renderRankHistoryChart/);
  assert.doesNotMatch(kugouRuntime, /regional/i);
});

test('YouTube Music uses the same direct service read-model loader', () => {
  assert.match(tabs, /'youtube-music':[\s\S]*viewId: 'youtubeMusicView'/);
  assert.match(youtubeRuntime, /loadMusicServiceReadModel\(SERVICE\)/);
  assert.match(youtubeRuntime, /const SERVICE = 'youtube_music'/);
  assert.match(youtubeRuntime, /monthly_audience/);
  assert.match(youtubeRuntime, /total_views/);
  assert.match(youtubeRuntime, /payload\.releases/);
  assert.match(youtubeShell, /mountMusicServiceView/);
  assert.match(youtubeShell, /musicServiceTable/);
});

test('shared service CSS owns chart presentation and the retired regional stylesheet is not bundled', () => {
  assert.match(musicCss, /\.music-service-rank-legend/);
  assert.match(musicCss, /\.music-service-rank-chart/);
  assert.match(musicCss, /\.music-service-history-table/);
  assert.doesNotMatch(musicCss, /regional/i);
  assert.doesNotMatch(build, /regional-music\.css/);
});

test('dashboard navigation is bundled directly without a lazy loader workaround', () => {
  assert.match(entry, /dashboard-tabs\.js\?v=20261004\.1/);
  assert.doesNotMatch(build, /dashboard-tabs-loader|args\.path === '\.\/dashboard-tabs\.js/);
});
