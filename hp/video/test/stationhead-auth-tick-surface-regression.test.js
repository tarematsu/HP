import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);

function section(sourceText, start, end) {
  const startAt = sourceText.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = sourceText.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return sourceText.slice(startAt, endAt);
}

test('latched Stationhead login is surfaced before Tick pauses for authentication', () => {
  const tick = section(
    source,
    'void StationheadPlayer::Tick(int64_t nowMs) {',
    'void StationheadPlayer::Reconnect()',
  );
  const surfaceAt = tick.indexOf(
    'if (!spotifyAuthorization_ && loginRequired_ &&\n      selectedTab_ != StationheadTabKind::Stationhead) {\n    ShowForLogin();\n  }',
  );
  const authPauseAt = tick.indexOf('if (spotifyAuthorization_ || loginRequired_) {');

  assert.ok(surfaceAt >= 0, 'Tick must surface a latched in-page authentication state');
  assert.ok(authPauseAt > surfaceAt, 'authentication must be surfaced before Tick returns');
});
