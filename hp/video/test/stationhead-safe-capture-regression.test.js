import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/scripts/capture-stationhead-network-sanitized.ps1', import.meta.url),
  'utf8',
);
const safePowerShell = readFileSync(
  new URL('../../native/scripts/capture-stationhead-play-stats-safe.ps1', import.meta.url),
  'utf8',
);
const safeCapture = readFileSync(
  new URL('../../native/scripts/capture-stationhead-play-stats-safe.mjs', import.meta.url),
  'utf8',
);

test('the sanitized command defaults to the narrow streakStats collector', () => {
  assert.match(wrapper, /capture-stationhead-play-stats-safe\.ps1/);
  assert.match(wrapper, /\[switch\]\$UnsafeFullCapture/);
  assert.match(wrapper, /IncludeAllResourceTypes requires -UnsafeFullCapture/);
  assert.match(wrapper, /UNSAFE FULL CAPTURE ENABLED/);
});

test('the safe collector accepts only the authenticated streakStats endpoint', () => {
  assert.match(
    safeCapture,
    /parsed\.hostname !== "production1\.stationhead\.com"/,
  );
  assert.match(
    safeCapture,
    /\^\\\/me\\\/channel\\\/\\d\+\\\/streakStats\$/,
  );
  assert.doesNotMatch(safeCapture, /requestHeaders|responseHeaders|postData|payloadData/);
  assert.doesNotMatch(safeCapture, /Network\.webSocket/);
  assert.doesNotMatch(safeCapture, /authorization|cookie|sth-device-uid/i);
});

test('safe output contains only normalized statistics metadata', () => {
  for (const required of [
    'endpoint: "/me/channel/{channelId}/streakStats"',
    'status: response.status',
    'serverDate:',
    'timezone:',
    'pointCount:',
    'firstPoint:',
    'lastPoint:',
    'chartData,',
  ]) {
    assert.ok(safeCapture.includes(required), `missing ${required}`);
  }
  assert.match(safePowerShell, /capture-stationhead-play-stats-safe\.mjs/);
  assert.match(safeCapture, /StationheadSafeCaptureProfile/);
});
