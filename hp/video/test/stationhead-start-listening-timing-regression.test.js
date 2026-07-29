import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const measurement = readFileSync(
  new URL('../../../scripts/measure-stationhead-start-listening.mjs', import.meta.url),
  'utf8',
);
const workflow = readFileSync(
  new URL('../../../.github/workflows/sh-live-js-audit.yml', import.meta.url),
  'utf8',
);
const policy = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
  'utf8',
);

test('the live timing audit measures from navigation start to visible Start Listening', () => {
  assert.match(measurement, /const navigationStartedAt = performance\.now\(\);/);
  assert.match(measurement, /const visiblePromise = findStartListening\(page, 30_000\);/);
  assert.match(measurement, /startListeningVisibleAfterMs: visibleAfterNavigationMs/);
  assert.match(measurement, /p95VisibleAfterMs: percentile\(visibility, 0\.95\)/);
  assert.match(measurement, /maxVisibleAfterMs: percentile\(visibility, 1\)/);
});

test('GitHub Actions runs six live visibility samples and publishes the artifact', () => {
  assert.match(workflow, /scripts\/measure-stationhead-start-listening\.mjs/);
  assert.match(workflow, /--attempts=3/);
  assert.match(workflow, /\.sh-start-listening-timing\/report\.json/);
  assert.match(workflow, /p95VisibleAfterMs/);
  assert.match(workflow, /timing\.visibleCount !== timing\.sampleCount/);
});

test('the native click suppression is rounded to the measured 3.467-second maximum', () => {
  assert.match(
    policy,
    /kStationheadMeasuredPostPlaybackStopClickDelayMs\s*=\s*\n\s*3'500/,
  );
  assert.doesNotMatch(
    policy,
    /kStationheadMeasuredPostPlaybackStopClickDelayMs\s*=\s*\n\s*12'000/,
  );
});
