import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const cmake = readFileSync(
  new URL('../../native/CMakeLists.txt', import.meta.url),
  'utf8',
);
const player = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const activePolicy = readFileSync(
  new URL('../../native/src/sh_playback_resource_policy_fix.h', import.meta.url),
  'utf8',
);
const webviewPolicy = readFileSync(
  new URL('../../native/src/sh_july19_stats_policy_fix.h', import.meta.url),
  'utf8',
);

test('sh.cpp receives the fixed stats generator through its actual PCH path', () => {
  assert.match(
    cmake,
    /target_precompile_headers\(HomePanel PRIVATE[\s\S]*src\/sh_playback_resource_policy_fix\.h/,
  );
  assert.doesNotMatch(player, /#include "sh_track_boundary_script\.h"/);
  assert.match(player, /StationheadApiPlayStatsScript\(config_\.channelId\)/);
  assert.match(
    activePolicy,
    /#define StationheadApiPlayStatsScript StationheadPrimaryPlayStatsScript/,
  );
});

test('the generator used by PollDailyPlayStats supports the existing WebView session', () => {
  assert.match(activePolicy, /const captured = window\.__homepanelStationheadAuthHeaders/);
  assert.match(activePolicy, /const requestHeaders = \{ accept: 'application\/json' \}/);
  assert.match(
    activePolicy,
    /if \(captured\?\.authorization\) Object\.assign\(requestHeaders, captured\)/,
  );
  assert.match(activePolicy, /credentials: 'include'/);
  assert.match(activePolicy, /headers: requestHeaders/);
  assert.doesNotMatch(activePolicy, /error: 'no-auth-header'/);
});

test('the active generator invalidates Authorization only on 401', () => {
  const unauthorizedAt = activePolicy.indexOf('if (response.status === 401) {');
  const forbiddenAt = activePolicy.indexOf('if (response.status === 403) {');
  assert.ok(unauthorizedAt >= 0);
  assert.ok(forbiddenAt > unauthorizedAt);

  const unauthorized = activePolicy.slice(unauthorizedAt, forbiddenAt);
  assert.match(unauthorized, /__homepanelStationheadRejectedAuthorization/);
  assert.match(unauthorized, /__homepanelStationheadAuthHeaders = null/);
  assert.match(unauthorized, /stationhead-play-stats-auth-failed/);

  const forbidden = activePolicy.slice(
    forbiddenAt,
    activePolicy.indexOf('if (!response.ok)', forbiddenAt),
  );
  assert.match(forbidden, /stationhead-play-stats-error/);
  assert.match(forbidden, /error: 'forbidden'/);
  assert.doesNotMatch(forbidden, /__homepanelStationheadRejectedAuthorization/);
  assert.doesNotMatch(forbidden, /__homepanelStationheadAuthHeaders = null/);
});

test('successful payload still enters the existing native-store bridge', () => {
  assert.match(
    activePolicy,
    /post\(\{ type: 'stationhead-play-stats', data, source: 'authenticated-api' \}\)/,
  );
  assert.match(webviewPolicy, /#include "sh_stats_webview_message_policy_fix\.h"/);
});
