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

test('Window A and B publish interactive states as pending placement', () => {
  for (const [start, end] of [
    ['class AppStationheadHandle final', 'class AppSecondaryStationheadHandle final'],
    ['class AppSecondaryStationheadHandle final', '}  // namespace hp'],
  ]) {
    const handle = section(handleHeader, start, end);
    assert.match(handle, /StationheadStatus Status\(\) const/);
    assert.match(
      handle,
      /status\.loginRequired \|\| status\.spotifyAuthorization \|\| status\.processFailed/,
    );
    assert.match(handle, /status\.audioPlaying = false;/);
    assert.match(handle, /status\.playing = false;/);
  }
});

test('dual-window placement constrains pending A left and pending B right', () => {
  const placement = section(
    appSource,
    'void App::ApplyStationheadWindowPlacement(',
    'void App::PublishRenderState()',
  );
  assert.match(placement, /primaryPending = !primaryStatus\.audioPlaying;/);
  assert.match(placement, /secondaryPending = secondaryStationhead_ && !secondaryStatus\.playing;/);
  assert.match(placement, /stationhead_->SetBounds\(primaryPending \? left : bounds\);/);
  assert.match(
    placement,
    /secondaryStationhead_->SetBounds\(secondaryPending \? right : bounds\);/,
  );
});
