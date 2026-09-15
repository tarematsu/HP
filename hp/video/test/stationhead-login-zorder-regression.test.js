import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url), 'utf8');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('interactive Stationhead is re-raised after every handle tick', () => {
  const tick = section(source, 'void StationheadHandleBase::Tick(int64_t nowMs)',
    'void StationheadHandleBase::ShowAfterAudioStop()');
  assert.ok(
    tick.indexOf('player_->EvaluateAudioLossRecovery(nowMs);') <
      tick.indexOf('RaiseActiveHost();'),
  );

  const raise = section(source, 'void StationheadHandleBase::RaiseActiveHost() const',
    'void StationheadHandleBase::ApplyBounds()');
  assert.match(raise, /!player_->SurfaceVisible\(\)/);
  assert.match(raise, /SetWindowPos\(host, HWND_TOP/);
  assert.match(raise, /if \(interactive\) BringMainWindowToFront\(host\);/);
});
