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
  ]) assert.match(shellSource, new RegExp(`(?:id=\\"${id}\\"|id: '${id}'|valueId: '${id}'|bodyId: '${id}')`));
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
