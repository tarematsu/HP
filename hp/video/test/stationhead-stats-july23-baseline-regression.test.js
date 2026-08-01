import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const trackBoundary = readFileSync(
  new URL('../../native/src/sh_track_boundary_script.h', import.meta.url),
  'utf8',
);
const baselinePolicy = readFileSync(
  new URL('../../native/src/sh_stats_july23_baseline_policy_fix.h', import.meta.url),
  'utf8',
);
const playbackPolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const sharedEnvironment = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

const restoredScriptNames = [
  'StationheadAuthCaptureScript',
  'StationheadApiPlayStatsScript',
  'StationheadAuthProbeScript',
];

function generatedStatsScript(channelId = 318) {
  const start = baselinePolicy.indexOf(
    'inline std::wstring StationheadApiPlayStatsScriptPayloadSafe',
  );
  const end = baselinePolicy.indexOf(
    'inline std::wstring StationheadAuthProbeScriptJuly23Baseline',
    start,
  );
  assert.ok(start >= 0 && end > start);
  const source = baselinePolicy.slice(start, end);
  const match = source.match(
    /script << LR"JS\(([\s\S]*?)\)JS"\s*<< channelId << LR"JS\(([\s\S]*?)\)JS";/,
  );
  assert.ok(match, 'generated stats script raw-string boundary is intact');
  return `${match[1]}${channelId}${match[2]}`;
}

async function runGeneratedStatsScript(payload) {
  const messages = [];
  const timers = [];
  const window = {
    __homepanelStationheadAuthHeaders: {
      authorization: 'Bearer fixture',
      'sth-device-uid': 'fixture-device',
      'app-platform': 'web',
      'app-version': '1.0.0',
    },
    chrome: {
      webview: {
        postMessage(message) {
          messages.push(JSON.parse(JSON.stringify(message)));
        },
      },
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  };
  const context = {
    window,
    fetch: async () => ({
      status: 200,
      ok: true,
      async json() {
        return payload;
      },
    }),
    Date,
    Event,
    console,
  };
  vm.runInNewContext(generatedStatsScript(), context);
  for (let count = 0; count < 4; count += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { messages, timers, window };
}

test('July 23 authentication boundary remains selected before final resource reductions', () => {
  const dataPolicyAt = trackBoundary.indexOf(
    '#include "sh_data_acquisition_resource_policy_fix.h"',
  );
  const baselineAt = trackBoundary.indexOf(
    '#include "sh_stats_july23_baseline_policy_fix.h"',
  );
  const startupAt = trackBoundary.indexOf(
    '#include "sh_startup_resource_reduction_policy_fix.h"',
  );
  const playbackAt = trackBoundary.indexOf(
    '#include "sh_playback_resource_policy_fix.h"',
  );
  assert.ok(dataPolicyAt >= 0 && dataPolicyAt < baselineAt);
  assert.ok(baselineAt < startupAt && startupAt < playbackAt);

  for (const name of restoredScriptNames) {
    assert.match(baselinePolicy, new RegExp(`#undef ${name}`));
  }
  assert.match(baselinePolicy, /return StationheadAuthCaptureScript\(\);/);
  assert.match(
    baselinePolicy,
    /return StationheadAuthProbeScript\(channelId\);/,
  );
  assert.match(
    baselinePolicy,
    /#define StationheadApiPlayStatsScript \\\n  StationheadApiPlayStatsScriptPayloadSafe/,
  );
  assert.match(
    playbackPolicy,
    /#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingPlaybackSafe/,
  );
});

test('play stats keep page-owned auth while normalizing every supported payload shape', () => {
  assert.match(
    baselinePolicy,
    /const headers = window\.__homepanelStationheadAuthHeaders;/,
  );
  assert.match(
    baselinePolicy,
    /production1\.stationhead\.com\/me\/channel\//,
  );
  assert.match(baselinePolicy, /credentials: 'include'/);
  assert.match(
    baselinePolicy,
    /'chart_data', 'chartData', 'daily', 'history', 'points', 'values'/,
  );
  assert.match(
    baselinePolicy,
    /point\.ts \?\? point\.timestamp \?\? point\.date \?\? point\.day \?\? point\.x/,
  );
  assert.match(
    baselinePolicy,
    /point\.val \?\? point\.value \?\? point\.count \?\? point\.plays[\s\S]*point\.listens \?\? point\.y/,
  );
  assert.match(baselinePolicy, /numeric < 100000000000/);
  assert.match(baselinePolicy, /numeric > 100000000000000/);
  assert.match(
    baselinePolicy,
    /Object\.entries\(candidate\)\.map\(\(\[date, value\]\) => \(\{ date, value \}\)\)/,
  );
  assert.match(
    baselinePolicy,
    /positiveCount\(right\) - positiveCount\(left\)/,
  );
  assert.match(
    baselinePolicy,
    /data: \{ chart_data: chartData \}/,
  );
});

test('generated stats script selects positive nested data over a zero placeholder', async () => {
  const seconds = 1_775_865_600;
  const { messages, timers, window } = await runGeneratedStatsScript({
    chart_data: [{ ts: seconds, val: 0 }],
    data: {
      history: [
        { timestamp: seconds, plays: '1,234' },
        { timestamp: seconds + 86_400, plays: 88 },
      ],
    },
  });
  const stats = messages.find((message) => message.type === 'stationhead-play-stats');
  assert.ok(stats);
  assert.deepEqual(stats.data.chart_data, [
    { ts: seconds * 1000, val: 1234 },
    { ts: (seconds + 86_400) * 1000, val: 88 },
  ]);
  assert.equal(stats.source, 'authenticated-api-normalized');
  assert.equal(timers.length, 0);
  assert.ok(window.__homepanelStationheadPlayStatsSuccessAt > 0);
  assert.equal(
    window.__homepanelStationheadPlayStatsAuthorization,
    'Bearer fixture',
  );
});

test('generated stats script accepts ISO-date object maps', async () => {
  const { messages } = await runGeneratedStatsScript({
    result: {
      daily: {
        '2026-07-31T00:00:00.000Z': '41',
        '2026-08-01T00:00:00.000Z': '52',
      },
    },
  });
  const stats = messages.find((message) => message.type === 'stationhead-play-stats');
  assert.ok(stats);
  assert.deepEqual(
    stats.data.chart_data.map((point) => point.val),
    [41, 52],
  );
  assert.ok(stats.data.chart_data.every((point) => point.ts > 1_700_000_000_000));
});

test('invalid payloads are retried without caching a false success', async () => {
  assert.match(
    baselinePolicy,
    /if \(!chartData\.length\) \{[\s\S]*resetSuccessThrottle\(\);[\s\S]*schedulePayloadRetry\(\);/,
  );
  assert.match(
    baselinePolicy,
    /__homepanelStationheadPlayStatsPayloadRetryTimer[\s\S]*30 \* 1000/,
  );
  assert.match(
    baselinePolicy,
    /__homepanelStationheadPlayStatsAuthorization = headers\.authorization/,
  );
  assert.match(
    baselinePolicy,
    /lastSuccessAuthorization === headers\.authorization/,
  );
  assert.match(
    baselinePolicy,
    /__homepanelStationheadPlayStatsInFlight/,
  );
  assert.doesNotMatch(
    baselinePolicy,
    /stationhead-play-stats-diagnostic|response body|authorization fingerprint/i,
  );

  const { messages, timers, window } = await runGeneratedStatsScript({
    data: { chart_data: [{ timestamp: 'not-a-date', count: 'not-a-number' }] },
  });
  assert.equal(
    messages.some((message) => message.type === 'stationhead-play-stats'),
    false,
  );
  assert.ok(messages.some(
    (message) => message.type === 'stationhead-play-stats-error'
      && message.error === 'invalid-payload',
  ));
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 30_000);
  assert.equal(window.__homepanelStationheadPlayStatsSuccessAt, 0);
  assert.equal(window.__homepanelStationheadPlayStatsAuthorization, '');
});

test('final playback controller reset clears cache without clearing login state', () => {
  assert.match(
    playbackPolicy,
    /CallDevToolsProtocolMethod\(\s*L"Network\.clearBrowserCache", L"\{\}", nullptr\);/,
  );
  assert.doesNotMatch(
    playbackPolicy,
    /ClearBrowsingDataAll|BROWSING_DATA_KINDS_COOKIES|ALL_DOM_STORAGE|DeleteAllCookies/,
  );
  assert.match(playbackPolicy, /Cookies and DOM storage remain intact/);
});

test('HTTP cache is session-local instead of permanently disabled', () => {
  assert.doesNotMatch(sharedEnvironment, /--disable-http-cache/);
  assert.match(sharedEnvironment, /--disable-features=BackForwardCache/);
  assert.match(
    sharedEnvironment,
    /HTTP[\s\S]*cache is enabled during a live controller session[\s\S]*explicitly reset/,
  );
});
