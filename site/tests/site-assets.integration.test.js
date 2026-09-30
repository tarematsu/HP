import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(siteRoot, 'public');

async function text(relativePath) {
  return readFile(path.join(siteRoot, relativePath), 'utf8');
}

test('main page references only existing local static assets', async () => {
  const html = await text('public/index.html');
  const references = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)]
    .map((match) => match[1])
    .filter((value) => value.startsWith('/') && !value.startsWith('//'))
    .map((value) => value.split(/[?#]/, 1)[0])
    .filter(Boolean);

  assert.ok(references.length >= 2, 'the dashboard should reference its CSS and JavaScript entry');
  for (const reference of new Set(references)) {
    await assert.doesNotReject(
      access(path.join(publicRoot, reference.replace(/^\//, ''))),
      `missing dashboard asset: ${reference}`,
    );
  }
});

test('dashboard skeleton and shell modules keep accessibility, privacy and all public sections', async () => {
  const html = await text('public/index.html');
  const registry = await text('public/dashboard-tab-registry.js');
  const currentShell = await text('public/current-shell.js');
  const historyShell = await text('public/history-shell.js');
  const likesShell = await text('public/likes-shell.js');
  const shellSource = [currentShell, historyShell, likesShell].join('\n');
  assert.match(html, /<html lang="ja"(?:\s[^>]*)?>/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /noindex,nofollow/);
  for (const id of [
    'trackFallback', 'online', 'members', 'totalStreams', 'membersYesterdayDelta', 'membersDayBeforeDelta',
    'streamsYesterdayDelta', 'streamsDayBeforeDelta', 'nowPlayingLink', 'queue', 'metricGoalCompact', 'streamGoal',
    'goalEta', 'audienceChart', 'historyView', 'likesView', 'likesRankingList', 'likesTbody',
  ]) assert.match(shellSource, new RegExp(`(?:id=\\"${id}\\"|id: '${id}'|valueId: '${id}')`));
  for (const id of ['channelName', 'channelFallback', 'updated']) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(shellSource, /id="streamCount"|id="goalMilestones"|goal-card/);
  assert.match(registry, /view: 'current', label: '現在', active: true/);
  assert.match(registry, /view: 'history', mode: 'daily', label: '過去'/);
  assert.match(registry, /view: 'likes', mode: 'likes', label: 'いいね'/);
  assert.match(currentShell, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /href="\/history/);
  assert.doesNotMatch(html, /id="currentView"|id="historyView"|id="likesView"/);
});

test('dashboard current page renders online history and direct five-minute playback counts from one payload', async () => {
  const currentShell = await text('public/current-shell.js');
  const client = await text('public/dashboard-client.js');
  const entry = await text('public/dashboard-metrics.js');
  const chart = await text('public/dashboard-chart-comparison.js');
  const detail = await text('public/dashboard-chart-detail.js');
  assert.match(currentShell, /id="audienceChart"/);
  assert.match(currentShell, /class="online-key">オンライン<\/span>/);
  assert.doesNotMatch(currentShell, /<h2>オンライン数<\/h2>|コメント勢い/);
  assert.match(client, /const DASHBOARD_URL = '\/api\/dashboard\?history=0'/);
  assert.match(client, /payload\.queue/);
  assert.doesNotMatch(entry, /dashboard-details-client\.js/);
  assert.match(chart, /payload\?\.history/);
  assert.match(chart, /payload\?\.stream_5m_history/);
  assert.match(chart, /dashboard:payload/);
  assert.match(chart, /online_member_count/);
  assert.doesNotMatch(chart, /再生数増加\/分（5分平均）|comment_velocity|commentVelocity|コメント\/2分/);
  assert.match(detail, /再生数増加 \+\$\{numberText\(streamRow\.stream_delta\)\}/);
  assert.doesNotMatch(detail, /comment_velocity|commentVelocity|コメント勢い/);
});

test('dashboard displays completed UTC-day changes from the unified materialized response', async () => {
  const currentShell = await text('public/current-shell.js');
  const entry = await text('public/dashboard-metrics.js');
  const renderer = await text('public/dashboard-daily-summaries.js');
  const criticalEndpoint = await text('functions/api/dashboard.js');
  const loader = await text('functions/lib/dashboard-daily-summaries.js');
  assert.match(currentShell, /label: '総メンバー数'/);
  assert.match(currentShell, /label: '総再生数'/);
  assert.match(entry, /dashboard-daily-summaries\.js\?v=20260930\.2/);
  assert.match(renderer, /renderDashboardDailySummaries/);
  assert.match(renderer, /dashboard:payload/);
  assert.match(renderer, /payload\?\.daily_summaries/);
  assert.match(criticalEndpoint, /daily_summaries/);
  assert.match(criticalEndpoint, /augmentDashboardChartData/);
  assert.match(loader, /FROM sh_daily_summary/);
  assert.match(renderer, /member_growth/);
  assert.match(renderer, /stream_growth/);
});

test('dashboard declares and implements a light white-base theme', async () => {
  const html = await text('public/index.html');
  const css = await text('public/app-lite.css');
  assert.match(html, /name="theme-color" content="#ffffff"/);
  assert.match(html, /name="color-scheme" content="light"/);
  assert.match(css, /color-scheme:\s*light/);
  assert.match(css, /--bg:\s*#f6f8fb/);
  assert.match(css, /--panel:\s*#ffffff/);
  assert.match(css, /#audienceChart \{[^}]*background:\s*#fff/);
});

test('mobile dashboard loads one first-paint stylesheet and one bundled entry script', async () => {
  const html = await text('public/index.html');
  const entry = await text('public/dashboard-metrics.js');
  const bundledCss = html.match(/\/assets\/dashboard\.min\.css\?v=[^"']+/)?.[0];
  const bundledJs = html.match(/\/assets\/dashboard\.min\.js\?v=[^"']+/)?.[0];
  assert.ok(bundledCss, 'dashboard.min.css must have an explicit deployment version');
  assert.ok(bundledJs, 'dashboard.min.js must have an explicit deployment version');
  assert.ok(html.indexOf(bundledCss) < html.indexOf('</head>'));
  assert.match(html, /type="module" src="\/assets\/dashboard\.min\.js\?v=[^"']+"/);
  assert.equal((html.match(/<link rel="stylesheet"/g) || []).length, 1);
  assert.equal((html.match(/<script /g) || []).length, 1);
  assert.match(entry, /import\('\/dashboard-client\.js\?v=[^']+'\)/);
});

test('dashboard mobile layout prevents metric and goal number clipping', async () => {
  const css = await text('public/app-lite.css');
  const layout = await text('public/pages-layout.css');
  assert.match(layout, /@media \(max-width: 760px\)[\s\S]*?\.metric,\s*\.metric\.featured\s*\{[^}]*grid-column:\s*auto\s*!important/s);
  assert.match(layout, /\.metric strong,\s*\.metric\.featured strong\s*\{[^}]*font-size:\s*clamp\(1\.08rem, 5\.7vw, 1\.45rem\)\s*!important/s);
  assert.match(css, /\.metric strong \{[^}]*white-space:\s*nowrap/);
  assert.match(css, /\.goal-number \{[^}]*flex-wrap:\s*wrap/);
  assert.match(css, /\.top-actions \{[^}]*repeat\(2/);
});