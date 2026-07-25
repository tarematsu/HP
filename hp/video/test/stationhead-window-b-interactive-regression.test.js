import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handleHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../../native/src/app.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('Stationhead attention states request a foreground surface even while audio continues', () => {
  const needsForeground = section(
    handleHeader,
    'inline bool StationheadNeedsForeground(',
    'enum class WorkspaceTab',
  );
  assert.match(needsForeground, /status\.loginRequired/);
  assert.match(needsForeground, /status\.spotifyAuthorization/);
  assert.match(needsForeground, /status\.processFailed/);
  assert.match(needsForeground, /!status\.audioPlaying/);
});

test('Window B interactive state is not exposed as reusable healthy playback', () => {
  const secondaryHandle = section(
    handleHeader,
    'class AppSecondaryStationheadHandle final',
    '}  // namespace hp',
  );
  assert.match(secondaryHandle, /StationheadStatus Status\(\) const/);
  assert.match(
    secondaryHandle,
    /status\.loginRequired \|\| status\.spotifyAuthorization \|\| status\.processFailed/,
  );
  assert.match(secondaryHandle, /status\.audioPlaying = false;/);
  assert.match(secondaryHandle, /status\.playing = false;/);

  const tick = section(appSource, 'void App::Tick()', 'void App::Draw()');
  assert.match(
    tick,
    /secondaryAudioPlaying,[\s\S]*renderState_\.stationhead\.secondaryPlaying/,
  );
  assert.match(tick, /secondaryStatus = secondaryStationhead_->Status\(\);/);
});

test('Window B remains constrained to its right-half placement while pending', () => {
  const placement = section(
    appSource,
    'void App::ApplyStationheadWindowPlacement(',
    'void App::PublishRenderState()',
  );
  assert.match(placement, /secondaryPending = secondaryStationhead_ && !secondaryStatus\.playing;/);
  assert.match(
    placement,
    /secondaryStationhead_->SetBounds\(secondaryPending \? right : bounds\);/,
  );
  assert.match(placement, /secondaryStationhead_->RefreshVisibility\(\);/);
});
