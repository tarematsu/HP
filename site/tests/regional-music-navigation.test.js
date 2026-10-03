import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/regional-music.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/regional-music-shell.js', import.meta.url), 'utf8');
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
  'genie',
  'kkbox',
  'qq_music',
  'kugou_music',
];

const removedLocalServices = [
  'bugs',
  'joox',
  'nhaccuatui',
  'anghami',
  'melon',
  'netease_cloud_music',
  'naver_vibe',
  'flo',
  'yandex_music',
  'boomplay',
  'plern',
  'fungjai',
  'zing_mp3',
  'jiosaavn',
  'gaana',
  'langit_musik',
];

test('music subscriptions render all visible services directly without category tabs', () => {
  assert.match(html, /id="subscriptionSourceTabsTemplate"/);
  const template = html.match(/<template id="subscriptionSourceTabsTemplate">([\s\S]*?)<\/template>/);
  assert.ok(template, 'subscription source template must exist');
  assert.doesNotMatch(template[1], /data-subscription-group(?:-content)?=/);
  assert.doesNotMatch(template[1], /dashboard-subscription-groups|dashboard-source-group/);
  assert.match(template[1], /class="dashboard-source-row"/);
  for (const service of visibleSubscriptionServices) {
    assert.match(template[1], new RegExp(`data-source="${service}"`));
  }
  for (const service of removedLocalServices) {
    assert.doesNotMatch(template[1], new RegExp(`data-source="${service}"`));
  }
  assert.match(template[1], /data-source="qq_music">🇨🇳QQ音乐<\/button>/);
  assert.match(template[1], /data-source="kugou_music">🇨🇳酷狗音乐<\/button>/);
  assert.match(tabs, /REGIONAL_MUSIC_MODES/);
  assert.match(tabs, /\bkkbox\b/);
  assert.match(runtime, /kkbox: 'KKBOX'/);
  assert.match(tabs, /subscriptionSourceTabsTemplate/);
  assert.match(css, /\.dashboard-source-tabs\.is-multiline/);
  assert.match(css, /\.dashboard-source-row/);
  assert.doesNotMatch(css, /dashboard-subscription-groups|data-subscription-group-content|dashboard-source-group/);
});

test('regional service views load one materialized read model per service', () => {
  assert.match(runtime, /const readModelPromises = new Map\(\)/);
  assert.match(runtime, /fetch\(`\/api\/regional-music\?service=\$\{encodeURIComponent\(serviceId\)\}`/);
  assert.match(runtime, /payload\.service !== serviceId/);
  assert.match(runtime, /regionalMusicUpdated', dateTimeText\(payload\.updated_at\)/);
  assert.match(shell, /id: 'regionalMusicView'/);
  assert.match(shell, /regionalMusicArtistBody/);
  assert.match(shell, /regionalMusicTrackBody/);
  assert.match(shell, /regionalMusicPlaylistBody/);
  assert.match(build, /'regional-music\.css'/);
});

test('Kugou exposes Japan and ACG chart history with shared filters', () => {
  assert.match(html, /data-source="kugou_music"/);
  assert.match(runtime, /payload\?\.kugou_japan_chart/);
  assert.match(runtime, /payload\?\.kugou_acg_chart/);
  assert.match(runtime, /renderRankHistoryChart/);
  assert.match(runtime, /service === 'kugou_music'/);
  assert.match(runtime, /kugouArtistFilter/);
  assert.match(runtime, /kugouArtistVisible/);
  assert.match(runtime, /kugou_music: '平日11:30 \/ ACG新歌榜: 水曜11:40'/);
  assert.match(runtime, /dateLabel:\s*providerDateText/);
  assert.match(runtime, /providerDateText\(item\.published_at\)/);
  assert.doesNotMatch(runtime, /providerDateTimeText/);
  assert.doesNotMatch(runtime, /Number\(item\.issue\)/);
  assert.match(shell, /酷狗音乐 日本榜 グループ別最高順位推移/);
  assert.match(shell, /酷狗音乐 日本榜 ランクイン履歴/);
  assert.match(shell, /酷狗音乐 ACG新歌榜 グループ別最高順位推移/);
  assert.match(shell, /酷狗音乐 ACG新歌榜 ランクイン履歴/);
  assert.match(shell, /headers: \['年月日', 'グループ', '順位', '曲名'\]/);
  assert.match(shell, /headers: \['更新日', 'グループ', '順位', '曲名'\]/);
  assert.doesNotMatch(shell, /headers: \['日時', 'グループ', '順位', '曲名', '号'\]/);
  assert.match(shell, /artistFilterButtons\('kugou', '酷狗音乐 日本榜 表示グループ'\)/);
  assert.match(shell, /artistFilterButtons\('kugou', '酷狗音乐 ACG新歌榜 表示グループ'\)/);
  assert.match(shell, /data-\$\{prefix\}-artist-filter="all"[^>]*>すべて<\/button>/);
  assert.match(shell, /data-\$\{prefix\}-artist-filter="sakurazaka46"[^>]*>櫻坂<\/button>/);
  assert.match(shell, /data-\$\{prefix\}-artist-filter="nogizaka46"[^>]*>乃木坂<\/button>/);
  assert.match(shell, /data-\$\{prefix\}-artist-filter="hinatazaka46"[^>]*>日向坂<\/button>/);
  assert.match(shell, /kugouJapanRankChart/);
  assert.match(shell, /kugouJapanRankLegend/);
  assert.match(shell, /kugouJapanHistoryBody/);
  assert.match(shell, /kugouAcgRankChart/);
  assert.match(shell, /kugouAcgRankLegend/);
  assert.match(shell, /kugouAcgHistoryBody/);
  assert.doesNotMatch(shell, /kugouJapanCoverage/);
  assert.match(runtime, /setCompactChartMode/);
  assert.match(runtime, /regionalMusicGenericTables/);
  assert.match(regionalCss, /\.regional-music-view\.is-chart-compact/);
  assert.match(regionalCss, /\.regional-chart-filter\.mode-tabs/);
});

test('QQ uses Thursday 18:00 cadence and date-only chart/history labels', () => {
  assert.match(shell, /QQ音乐 日本榜 グループ別最高順位推移/);
  assert.match(shell, /QQ音乐 日本榜 ランクイン履歴/);
  assert.match(shell, /QQ音乐 アーティスト別人気曲順位/);
  assert.match(shell, /qqArtistPopularityBody/);
  assert.match(shell, /artistFilterButtons\('qq', 'QQ音乐 日本榜 表示グループ'\)/);
  assert.match(shell, /headers: \['更新日', 'グループ', '順位', '曲名'\]/);
  assert.doesNotMatch(shell, /headers: \['週',/);
  assert.match(qqRuntime, /QQ_CHART_CADENCE = '毎週木曜日18:00'/);
  assert.match(qqRuntime, /fetch\('\/api\/regional-music\?service=qq_music'/);
  assert.match(qqRuntime, /dateLabel:providerDateText/);
  assert.doesNotMatch(qqRuntime, /function periodText/);
  assert.match(qqRuntime, /activeArtistFilter/);
  assert.match(qqRuntime, /artistVisible/);
  assert.match(qqRuntime, /payload\?\.artist_track_orders/);
  assert.match(qqRuntime, /item\?\.service === 'qq_music'/);
  assert.match(qqRuntime, /item\?\.position/);
  assert.match(qqRuntime, /renderPopularity\(payload\)/);
  assert.doesNotMatch(shell, /qqJapanCoverage/);
});

test('YouTube Music uses its service-scoped R2 read model and renders public metrics in its first-row tab', () => {
  assert.match(tabs, /'youtube-music':[\s\S]*viewId: 'youtubeMusicView'/);
  assert.match(youtubeRuntime, /fetch\('\/api\/regional-music\?service=youtube_music'/);
  assert.match(youtubeRuntime, /payload\.service !== SERVICE/);
  assert.match(youtubeRuntime, /const SERVICE = 'youtube_music'/);
  assert.match(youtubeRuntime, /monthly_audience/);
  assert.match(youtubeRuntime, /total_views/);
  assert.match(youtubeRuntime, /payload\.releases/);
  assert.match(youtubeRuntime, /youtubeMusicUpdated', dateTimeText\(payload\.updated_at\)/);
  assert.match(youtubeShell, /月間視聴者/);
  assert.match(youtubeShell, /総視聴回数/);
  assert.match(youtubeShell, /youtubeMusicReleaseBody/);
  assert.doesNotMatch(youtubeRuntime, /タブのみ先行追加|専用収集\/read model接続後/);
});

test('dashboard navigation is bundled directly without a lazy loader workaround', () => {
  assert.match(entry, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.doesNotMatch(build, /dashboard-tabs-loader|args\.path === '\.\/dashboard-tabs\.js/);
});
