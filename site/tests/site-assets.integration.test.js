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

test('dashboard skeleton and shared Stationhead shell keep accessibility, privacy and all channel sections', async () => {
  const html = await text('public/index.html');
  const registry = await text('public/dashboard-tab-registry.js');
  const currentShell = await text('public/current-shell.js');
  const stationheadShell = await text('public/stationhead-channel-shell.js');
  const historyShell = await text('public/history-shell.js');
  const likesShell = await text('public/likes-shell.js');

  assert.match(html, /<html lang="ja"(?:\s[^>]*)?>/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /noindex,nofollow/);
  for (const id of ['channelName', 'updated']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(currentShell, /mountStationheadChannelShell/);
  assert.match(currentShell, /stationheadModel = 'buddies'/);
  for (const role of ['online', 'streams', 'members', 'station-link', 'queue', 'track-bites', 'live-chart']) {
    assert.match(stationheadShell, new RegExp(`role\\('${role}'\\)`));
  }
  for (const section of ['current', 'history', 'played-tracks', 'likes', 'broadcasts']) {
    assert.match(stationheadShell, new RegExp(`data-stationhead-panel=\\"${section}\\"`));
  }
  assert.match(stationheadShell, /rel="noopener noreferrer"/);
  assert.doesNotMatch(stationheadShell, /goal-card|metricGoalCompact|streamGoal|goalEta/);
  assert.match(registry, /tabs\.replaceChildren\(\)/);
  assert.match(registry, /tabs\.hidden = true/);
  assert.match(historyShell, /id: 'historyView'/);
  assert.match(likesShell, /id: 'likesView'/);
  assert.doesNotMatch(html, /href="\/history/);
  assert.doesNotMatch(html, /id="currentView"|id="historyView"|id="likesView"/);
});

test('dashboard current page renders online history and direct five-minute playback counts from one payload', async () => {
  const currentShell = await text('public/current-shell.js');
  const stationheadShell = await text('public/stationhead-channel-shell.js');
  const stationheadRuntime = await text('public/stationhead-channel.js');
  const stationheadReadModel = await text('public/stationhead-channel-read-model.js');
  const entry = await text('public/dashboard-metrics.js');
  const cache = await text('public/dashboard-fetch-cache.js');

  assert.match(currentShell, /mountStationheadChannelShell/);
  assert.match(stationheadShell, /role\('live-chart'\)/);
  assert.match(stationheadShell, /過去24時間/);
  assert.match(stationheadRuntime, /payload\?\.history_24h/);
  assert.match(stationheadRuntime, /stream_delta_5m/);
  assert.match(stationheadRuntime, /online_member_count/);
  assert.match(stationheadRuntime, /context\.fillRect\(/);
  assert.doesNotMatch(stationheadRuntime, /comment_velocity|commentVelocity|コメント\/2分/);
  assert.match(stationheadReadModel, /fetchJson\('\/api\/dashboard\?history=0'/);
  assert.match(stationheadReadModel, /queue: Array\.isArray\(payload\?\.queue\) \? payload\.queue : \[\]/);
  assert.match(entry, /dashboard-fetch-cache\.js\?v=/);
  assert.match(cache, /url\.searchParams\.set\('since'/);
  assert.match(cache, /queue_revision/);
  assert.doesNotMatch(entry, /dashboard-details-client\.js/);
});
