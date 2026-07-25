import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedSource = readFileSync(
  new URL('../../native/src/sh_shared.h', import.meta.url),
  'utf8',
);
const policySource = readFileSync(
  new URL('../../native/src/sh_polling_policy.h', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);
const messagesSource = readFileSync(
  new URL('../../native/src/app_messages.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('runtime autoplay rechecks login state while audio remains active', () => {
  const autoplay = section(
    sharedSource,
    'inline std::wstring StationheadAutoplayScript(',
    'inline std::wstring StationheadVolumeScript(',
  );
  assert.match(autoplay, /let loginRecheckTimer = 0;/);
  assert.match(
    autoplay,
    /schedulePlayingLoginRecheck = \(\) =>[\s\S]*lastPlaying !== true[\s\S]*nativeTimeout\([\s\S]*schedule\(0\);[\s\S]*5000/,
  );
  assert.match(autoplay, /if \(isPlaying\) schedulePlayingLoginRecheck\(\);/);
  assert.match(
    autoplay,
    /homepanel-stationhead-auth-ready[\s\S]*loginReported = false;[\s\S]*schedule\(0\);/,
  );
  assert.doesNotMatch(
    autoplay,
    /homepanel-stationhead-auth-ready[\s\S]*scheduleUnlessPlaying\(0\);/,
  );

  const runtimeAutoplay = section(
    policySource,
    'inline std::wstring StationheadAutoplayScript(',
    '// Window A may ask for stats',
  );
  assert.match(runtimeAutoplay, /StationheadAutoplayScriptBase\(globalName, messagePrefix\)/);
});

test('Window A runtime stats throttle follows the validated authorization', () => {
  const stats = section(
    policySource,
    'inline std::wstring StationheadApiPlayStatsScript(',
    '// Window B must not make an extra logged-in API request',
  );
  assert.match(stats, /const resetSuccessThrottle = \(\) =>/);
  assert.match(stats, /__homepanelStationheadPlayStatsAuthorization = '';/);
  assert.match(
    stats,
    /lastSuccessAuthorization === headers\.authorization/,
  );
  assert.match(
    stats,
    /__homepanelStationheadPlayStatsAuthorization = headers\.authorization;/,
  );

  const unauthorized = section(
    stats,
    'if (response.status === 401)',
    'if (response.status === 403)',
  );
  assert.match(unauthorized, /__homepanelStationheadRejectedAuthorization/);
  assert.match(unauthorized, /__homepanelStationheadAuthHeaders = null/);

  const forbidden = section(
    stats,
    'if (response.status === 403)',
    'if (!response.ok)',
  );
  assert.match(forbidden, /resetSuccessThrottle\(\)/);
  assert.doesNotMatch(forbidden, /__homepanelStationheadRejectedAuthorization/);
  assert.doesNotMatch(forbidden, /__homepanelStationheadAuthHeaders = null/);
});

test('Window A keeps playback auth on 403 and preserves earlier wake deadlines', () => {
  const handler = section(
    webviewSource,
    'if (type == L"stationhead-play-stats-auth-failed")',
    'if (type == L"stationhead-auth-ready")',
  );
  assert.match(handler, /if \(status == 403\)/);
  assert.match(handler, /retaining the current playback session/);
  assert.match(handler, /now \+ kStationheadDailyPlayStatsIntervalMs/);
  assert.match(handler, /now \+ kStationheadDailyPlayStatsRetryMs/);
  assert.match(handler, /if \(nextTickAt_ > retryAt\) nextTickAt_ = retryAt;/);
  assert.doesNotMatch(handler, /nextTickAt_ = now \+ kStationheadDailyPlayStatsRetryMs;/);
});

test('Stationhead state notifications wake the central timer from idle cadence', () => {
  assert.match(messagesSource, /kStationheadChangeWakeMs = 2'000/);
  const changed = section(
    messagesSource,
    'case WM_HP_STATIONHEAD_CHANGED:',
    'case kStationheadHealthUpdatedMessage:',
  );
  assert.match(changed, /ScheduleNextTick\(kStationheadChangeWakeMs\);/);
});
