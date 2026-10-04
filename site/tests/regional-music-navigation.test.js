import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/regional-music.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/regional-music-shell.js', import.meta.url), 'utf8');
const commonShell = readFileSync(new URL('../public/music-service-shell.js', import.meta.url), 'utf8');
const commonRuntime = readFileSync(new URL('../public/music-service-runtime-common.js', import.meta.url), 'utf8');
const musicCss = readFileSync(new URL('../public/music-service-common.css', import.meta.url), 'utf8');
const regionalApi = readFileSync(new URL('../functions/api/regional-music.js', import.meta.url), 'utf8');
const qqRuntime = readFileSync(new URL('../public/qq-japan-chart-ui.js', import.meta.url), 'utf8');
const youtubeRuntime = readFileSync(new URL('../public/youtube-music.js', import.meta.url), 'utf8');
const youtubeShell = readFileSync(new URL('../public/youtube-music-shell.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/dashboard-navigation.css', import.meta.url), 'utf8');
const regionalCss = readFileSync(new URL('../public/regional-music.css', import.meta.url), 'utf8');
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

const retainedRegionalServices = ['kkbox', 'qq_music', 'kugou_music'];
const removedLocalServices = [
  'genie', 'bugs', 'joox', 'nhaccuatui', 'anghami', 'melon', 'netease_cloud_music',
  'naver_vibe', 'flo', 'yandex_music', 'boomplay', 'plern', 'fungjai', 'zing_mp3',
  'jiosaavn', 'gaana', 'langit_musik',
];

function quotedServicePattern(service) {
  return new RegExp(`['\"]${service}['\"]`);
}

test('music subscriptions use one source registry and expose only retained services', () => {
  const template = html.match(/<template id="subscriptionSourceTabsTemplate">([\s\S]*?)<\/template>/);
  assert.ok(template, 'subscription source template must exist');
  assert.doesNotMatch(template[1], /data-subscription-group(?:-content)?=/);
  assert.match(template[1], /class="dashboard-source-row"/);
  for (const service of visibleSubscriptionServices) {
    assert.match(template[1], new RegExp(`data-source="${service}"`));
  }
  for (const service of removedLocalServices) {
    assert.doesNotMatch(template[1], new RegExp(`data-source="${service}"`));
    assert.doesNotMatch(tabs, quotedServicePattern(service));
  }
  for (const service of retainedRegionalServices) assert.match(tabs, quotedServicePattern(service));
  assert.doesNotMatch(tabs, /function regionalSource\s*\(/);
  assert.doesNotMatch(tabs, /REGIONAL_MUSIC_MODES\.has\(mode\).*regionalSource/s);
  assert.match(template[1], /data-source="qq_music">🇨🇳QQ音乐<\/button>/);
  assert.match(template[1], /data-source="kugou_music">🇨🇳酷狗音乐<\/button>/);
  assert.match(css, /\.dashboard-source-tabs\.is-multiline/);
  assert.match(css, /\.dashboard-source-row/);
});

test('regional API rejects retired providers instead of preserving hidden routes', () => {
  for (const service of ['youtube_music', ...retainedRegionalServices]) {
    assert.match(regionalApi, quotedServicePattern(service));
  }
  for (const service of removedLocalServices) assert.doesNotMatch(regionalApi, quotedServicePattern(service));
});

test('regional, QQ, and YouTube reuse one materialized read-model loader', () => {
  assert.match(commonRuntime, /const readModelPromises = new Map\(\)/);
  assert.match(commonRuntime, /export function loadRegionalMusicReadModel/);
  assert.match(commonRuntime, /fetch\(`\/api\/regional-music\?service=\$\{encodeURIComponent\(serviceId\)\}`/);
  for (const source of [runtime, qqRuntime, youtubeRuntime]) {
    assert.match(source, /loadRegionalMusicReadModel/);
    assert.doesNotMatch(source, /const readModelPromise(?:s)? =/);
  }
  assert.match(runtime, /payload\.service/);
  assert.match(shell, /viewId: 'regionalMusicView'/);
  assert.match(shell, /regionalMusicArtistBody/);
  assert.match(shell, /regionalMusicTrackBody/);
  assert.match(shell, /regionalMusicPlaylistBody/);
  assert.match(build, /'regional-music\.css'/);
});

test('regional shell reuses shared filters, notices, tables, and service sections', () => {
  assert.match(shell, /musicServiceFilterTabs/);
  assert.match(shell, /musicServiceNotice/);
  assert.match(shell, /musicServiceTable/);
  assert.match(shell, /musicServiceSection/);
  assert.match(shell, /mountMusicServiceView/);
  assert.match(commonShell, /dashboardModeTabs/);
  assert.match(commonShell, /dashboardNotice/);
  assert.match(commonShell, /dashboardTable/);
  assert.doesNotMatch(shell, /<div class="mode-tabs regional-chart-filter"/);
});

test('Kugou exposes Japan and ACG chart history with shared filters', () => {
  assert.match(runtime, /payload\?\.kugou_japan_chart/);
  assert.match(runtime, /payload\?\.kugou_acg_chart/);
  assert.match(runtime, /renderRankHistoryChart/);
  assert.match(runtime, /kugouArtistFilter/);
  assert.match(commonRuntime, /kugou_music: '平日11:30 \/ ACG新歌榜: 水曜11:40'/);
  assert.match(runtime, /dateLabel:providerDateText/);
  assert.match(shell, /酷狗音乐 日本榜 グループ別最高順位推移/);
  assert.match(shell, /酷狗音乐 日本榜 ランクイン履歴/);
  assert.match(shell, /酷狗音乐 ACG新歌榜 グループ別最高順位推移/);
  assert.match(shell, /酷狗音乐 ACG新歌榜 ランクイン履歴/);
  assert.match(shell, /headers: \['年月日', 'グループ', '順位', '曲名'\]/);
  assert.match(shell, /headers: \['更新日', 'グループ', '順位', '曲名'\]/);
  assert.match(shell, /artistFilterButtons\('kugou', '酷狗音乐 日本榜 表示グループ'\)/);
  assert.match(shell, /kugouJapanRankChart/);
  assert.match(shell, /kugouAcgRankChart/);
  assert.match(runtime, /setCompactChartMode/);
  assert.match(runtime, /regionalMusicGenericTables/);
  assert.match(musicCss, /\.music-service-view\.is-chart-compact/);
  assert.doesNotMatch(regionalCss, /\.regional-music-view\.is-chart-compact/);
});

test('QQ uses shared cadence, read model, charts, filters, and tables', () => {
  assert.match(shell, /QQ音乐 日本榜 グループ別最高順位推移/);
  assert.match(shell, /QQ音乐 日本榜 ランクイン履歴/);
  assert.match(shell, /QQ音乐 アーティスト別人気曲順位/);
  assert.match(shell, /qqArtistPopularityBody/);
  assert.match(commonRuntime, /qq_music: '毎週木曜日18:00'/);
  assert.match(qqRuntime, /loadRegionalMusicReadModel\('qq_music'\)/);
  assert.match(qqRuntime, /activeArtistFilter/);
  assert.match(qqRuntime, /renderRankHistoryChart/);
  assert.match(qqRuntime, /appendTableRow/);
  assert.doesNotMatch(qqRuntime, /new MutationObserver/);
  assert.doesNotMatch(qqRuntime, /function (?:cell|row)\s*\(/);
});

test('YouTube Music shares the common runtime and renders public metrics', () => {
  assert.match(tabs, /'youtube-music':[\s\S]*viewId: 'youtubeMusicView'/);
  assert.match(youtubeRuntime, /loadRegionalMusicReadModel\(SERVICE\)/);
  assert.match(youtubeRuntime, /const SERVICE = 'youtube_music'/);
  assert.match(youtubeRuntime, /monthly_audience/);
  assert.match(youtubeRuntime, /total_views/);
  assert.match(youtubeRuntime, /payload\.releases/);
  assert.match(youtubeRuntime, /youtubeMusicUpdated', musicDateTimeText\(payload\.updated_at\)/);
  assert.match(youtubeShell, /月間視聴者/);
  assert.match(youtubeShell, /総視聴回数/);
  assert.match(youtubeShell, /youtubeMusicReleaseBody/);
  assert.match(youtubeShell, /mountMusicServiceView/);
  assert.match(youtubeShell, /musicServiceTable/);
  assert.doesNotMatch(youtubeRuntime, /youtubeMusicHealth|youtubeMusicStatus|youtubeMusicArtistCount|youtubeMusicTrackCount|youtubeMusicReleaseCount/);
  assert.doesNotMatch(youtubeRuntime, /function (?:cell|row)\s*\(/);
});

test('dashboard navigation is bundled directly without a lazy loader workaround', () => {
  assert.match(entry, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.doesNotMatch(build, /dashboard-tabs-loader|args\.path === '\.\/dashboard-tabs\.js/);
});
