import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const playerHeader = readFileSync(
  new URL('../../native/src/sh.h', import.meta.url),
  'utf8',
);
const playerSource = readFileSync(
  new URL('../../native/src/sh.cpp', import.meta.url),
  'utf8',
);
const webviewSource = readFileSync(
  new URL('../../native/src/sh_webview.cpp', import.meta.url),
  'utf8',
);
const boundaryPolicy = readFileSync(
  new URL('../../native/src/sh_track_boundary_message_policy.h', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('the player stores the 52-minute clock behind the final PCH proxy', () => {
  assert.match(playerHeader, /int64_t lastReloadAtStorage_ = 0;/);
  assert.doesNotMatch(playerHeader, /int64_t lastReloadAt_ = 0;/);
  assert.match(
    boundaryPolicy,
    /#define lastReloadAt_[\s\S]*StationheadBoundaryReloadClock\(\(lastReloadAtStorage_\), IsSecondary\(\)\)/,
  );
});

test('the first successful navigation initializes the clock once', () => {
  const assignment = section(
    boundaryPolicy,
    'int64_t operator=(int64_t candidate) noexcept',
    'private:',
  );
  assert.match(assignment, /bool accept = storage_ <= 0;/);
  assert.match(assignment, /if \(accept\) storage_ = candidate;/);
  assert.match(
    webviewSource,
    /if \(success\) \{[\s\S]*lastReloadAt_ = now;/,
  );
});

test('an App-accepted boundary message authorizes exactly one later clock assignment', () => {
  const wrapper = section(
    boundaryPolicy,
    'inline LRESULT SendMessageWWithStationheadBoundaryLease(',
    '}  // namespace hp',
  );
  assert.match(
    wrapper,
    /if \(result != 0\) \{[\s\S]*ReloadClockAssignmentPending[\s\S]*pending = true;/,
  );

  const assignment = section(
    boundaryPolicy,
    'int64_t operator=(int64_t candidate) noexcept',
    'private:',
  );
  assert.match(assignment, /if \(pending\) \{[\s\S]*pending = false;[\s\S]*accept = true;/);
  assert.ok(
    assignment.indexOf('pending = false;') < assignment.indexOf('if (accept) storage_ = candidate;'),
    'the authorization marker must be consumed before the clock is advanced',
  );
});

test('normal successful navigation cannot postpone an established 52-minute clock', () => {
  const assignment = section(
    boundaryPolicy,
    'int64_t operator=(int64_t candidate) noexcept',
    'private:',
  );
  assert.match(assignment, /bool accept = storage_ <= 0;/);
  assert.match(assignment, /if \(pending\)[\s\S]*accept = true;/);
  assert.doesNotMatch(assignment, /storage_ = candidate;[\s\S]*storage_ = candidate;/);
  assert.match(
    playerSource,
    /lastReloadAt_ = nowMs;[\s\S]*track-boundary authentication refresh/,
  );
});

test('filtered reload-clock writes preserve ConfigureWebView chained assignment', () => {
  const assignment = section(
    boundaryPolicy,
    'int64_t operator=(int64_t candidate) noexcept',
    'private:',
  );
  assert.match(assignment, /return candidate;/);
  assert.match(
    webviewSource,
    /createdAt_ = lastReloadAt_ = UnixMillis\(\);/,
  );
  assert.ok(
    assignment.indexOf('if (accept) storage_ = candidate;') <
      assignment.indexOf('return candidate;'),
    'the independent lifecycle timestamp must receive the current candidate',
  );
});

test('A and B use independent one-shot clock authorization markers', () => {
  assert.match(boundaryPolicy, /primaryReloadClockAssignmentPending = false;/);
  assert.match(boundaryPolicy, /secondaryReloadClockAssignmentPending = false;/);
  assert.match(
    boundaryPolicy,
    /secondary_[\s\S]*secondaryReloadClockAssignmentPending[\s\S]*primaryReloadClockAssignmentPending/,
  );
  assert.match(
    boundaryPolicy,
    /message == WM_HP_SECONDARY_RELOAD_READY[\s\S]*secondaryReloadClockAssignmentPending[\s\S]*primaryReloadClockAssignmentPending/,
  );
});
