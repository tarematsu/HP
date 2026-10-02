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

const rows = [
  ['1', ['spotify', 'apple-music', 'amazon-music', 'youtube-music']],
  ['2', ['genie', 'bugs', 'joox', 'nhaccuatui', 'anghami', 'melon']],
  ['3', ['naver_vibe', 'flo', 'yandex_music', 'boomplay', 'plern', 'fungjai']],
  ['4', ['zing_mp3', 'jiosaavn', 'gaana', 'langit_musik']],
  ['5', ['qq_music', 'netease_cloud_music', 'kugou_music']],
];

test('music subscriptions are grouped into major, local and China source rows', () => {
  assert.match(html, /id="subscriptionSourceTabsTemplate"/);
  assert.match(html, /href="#spotify" data-subscription-group="major">主要<\/a>/);
  assert.match(html, /href="#genie" data-subscription-group="local">ローカル<\/a>/);
  assert.match(html, /href="#qq_music" data-subscription-group="china">中国<\/a>/);
  assert.match(html, /data-subscription-group-content="major"/);
  assert.match(html, /data-subscription-group-content="local"/);
  assert.match(html, /data-subscription-group-content="china"/);
  assert.match(html, /data-source="qq_music">🇨🇳QQ音乐<\/button>/);
  assert.match(html, /data-source="kugou_music">🇨🇳酷狗音乐<\/button>/);
  const localGroup = html.match(/data-subscription-group-content="local"[\s\S]*?<\/div>\s*<div class="dashboard-source-group" data-subscription-group-content="china">/);
  assert.ok(localGroup, 'local subscription group must exist before China group');
  assert.doesNotMatch(localGroup[0], /data-source="(?:qq_music|netease_cloud_music|kugou_music)"/);
  const chinaGroup = html.match(/data-subscription-group-content="china"[\s\S]*?<\/div>\s*<\/template>/);
  assert.ok(chinaGroup, 'China subscription group must exist');
  for (const service of ['qq_music', 'netease_cloud_music', 'kugou_music']) {
    assert.match(chinaGroup[0], new RegExp(`data-source="${service}"`));
  }
  for (const [row, services] of rows) {
    const match = html.match(new RegExp(`<div class="dashboard-source-row" data-row="${row}"[\\s\\S]*?<\\/div>`));
    assert.ok(match, `subscription row ${row} must exist`);
    for (const service of services) assert.match(match[0], new RegExp(`data-source="${service}"`));
  }
  assert.match(tabs, /REGIONAL_MUSIC_MODES/);
  assert.match(tabs, /subscriptionSourceTabsTemplate/);
  assert.match(css, /\.dashboard-source-tabs\.is-multiline/);
  assert.match(css, /\.dashboard-subscription-groups/);
  assert.match(css, /:has\(\[data-subscription-group-content="major"\] \.active\)/);
  assert.match(css, /:has\(\[data-subscription-group-content="china"\] \.active\)/);
  assert.match(css, /\.dashboard-source-row\[data-row="1"\]/);
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

test('Kugou uses a compact Japan chart view with one shared artist filter for graph and history', () => {
  assert.match(html, /data-subscription-group-content="china"[\s\S]*data-source="kugou_music"/);
  assert.match(runtime, /payload\?\.kugou_japan_chart/);
  assert.match(runtime, /renderRankHistoryChart/);
  assert.match(runtime, /service === 'kugou_music'/);
  assert.match(runtime, /kugouArtistFilter/);
  assert.match(runtime, /kugouArtistVisible/);
  assert.match(runtime, /毎週月曜 00:00 JST/);
  assert.match(shell, /酷狗音乐 日本榜 グループ別最高順位推移/);
  assert.match(shell, /酷狗音乐 日本榜 ランクイン履歴/);
  assert.match(shell, /artistFilterButtons\('kugou', '酷狗音乐 日本榜 表示グループ'\)/);
  assert.match(shell, /data-\$\{prefix\}-artist-filter="all"[^>]*>すべて<\/button>/);
  assert.match(shell, /data-\$\{prefix\}-artist-filter="sakurazaka46"[^>]*>櫻坂<\/button>/);
  assert.match(shell, /data-\$\{prefix\}-artist-filter="nogizaka46"[^>]*>乃木坂<\/button>/);
  assert.match(shell, /data-\$\{prefix\}-artist-filter="hinatazaka46"[^>]*>日向坂<\/button>/);
  assert.match(shell, /kugouJapanRankChart/);
  assert.match(shell, /kugouJapanRankLegend/);
  assert.match(shell, /kugouJapanHistoryBody/);
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

test('YouTube Music uses the shared R2 read model but renders public metrics in its first-row tab', () => {
  assert.match(tabs, /'youtube-music':[\s\S]*viewId: 'youtubeMusicView'/);
  assert.match(youtubeRuntime, /fetch\('\/api\/regional-music'/);
  assert.match(youtubeRuntime, /const SERVICE = 'youtube_music'/);
  assert.match(youtubeRuntime, /monthly_audience/);
  assert.match(youtubeRuntime, /total_views/);
  assert.match(youtubeRuntime, /payload\.releases/);
  assert.match(youtubeShell, /月間視聴者/);
  assert.match(youtubeShell, /総視聴回数/);
  assert.match(youtubeShell, /youtubeMusicReleaseBody/);
  assert.doesNotMatch(youtubeRuntime, /タブのみ先行追加|専用収集\/read model接続後/);
});

test('dashboard navigation is bundled directly without a lazy loader workaround', () => {
  assert.match(entry, /dashboard-tabs\.js\?v=20260930\.1/);
  assert.doesNotMatch(build, /dashboard-tabs-loader|args\.path === '\.\/dashboard-tabs\.js/);
});
