import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('interactive Stationhead is re-raised after every native handle tick', () => {
  const tick = section(
    handleSource,
    'void StationheadHandleBase::Tick(int64_t nowMs)',
    'void StationheadHandleBase::Reconnect()',
  );
  const recoveryAt = tick.indexOf('player_->EvaluateAudioLossRecovery(nowMs);');
  const raiseAt = tick.indexOf('RaiseActiveHost();');
  assert.ok(recoveryAt >= 0 && raiseAt > recoveryAt);

  const raise = section(
    handleSource,
    'void StationheadHandleBase::RaiseActiveHost() const',
    'void StationheadHandleBase::ApplyInteractiveBounds()',
  );
  assert.match(raise, /if \(!preview && !player_->SurfaceVisible\(\)\) return;/);
  assert.match(raise, /SetWindowPos\(host, HWND_TOP/);
  assert.match(raise, /if \(!preview && interactive\) BringMainWindowToFront\(host\);/);
});
