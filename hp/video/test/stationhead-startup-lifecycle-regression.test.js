import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const handleHeader = readFileSync(
  new URL('../../native/src/app_stationhead_handles.h', import.meta.url),
  'utf8',
);
const handleSource = readFileSync(
  new URL('../../native/src/app_stationhead_handles.cpp', import.meta.url),
  'utf8',
);
const environmentSource = readFileSync(
  new URL('../../native/src/shared_webview_environment.cpp', import.meta.url),
  'utf8',
);

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, `missing section: ${start}`);
  const endAt = source.indexOf(end, startAt + start.length);
  assert.notEqual(endAt, -1, `missing section terminator: ${end}`);
  return source.slice(startAt, endAt);
}

test('Stationhead handle owns a single one-way startup lifecycle', () => {
  assert.match(handleHeader, /bool startIssued_ = false;/);
  assert.match(handleHeader, /bool stopIssued_ = false;/);

  const start = section(
    handleSource,
    'void StationheadHandleBase::Start() {',
    'void StationheadHandleBase::Tick(',
  );
  assert.match(start, /if \(!player_ \|\| startIssued_ \|\| stopIssued_\) return;/);
  assert.ok(start.indexOf('startIssued_ = true;') < start.indexOf('player_->Start();'));

  const stop = section(
    handleSource,
    'void StationheadHandleBase::Stop() {',
    'void StationheadHandleBase::SetAudioMuted(',
  );
  assert.match(stop, /if \(!player_ \|\| stopIssued_\) return;/);
  assert.ok(stop.indexOf('stopIssued_ = true;') < stop.indexOf('player_->Stop();'));
  assert.match(stop, /if \(startIssued_\) player_->Stop\(\);/);
});

test('stopped or not-yet-started players cannot receive startup-adjacent work', () => {
  for (const signature of [
    'void StationheadHandleBase::Tick(',
    'void StationheadHandleBase::Reconnect()',
    'void StationheadHandleBase::SetPlaybackFallback(',
    'void StationheadHandleBase::ShowAfterAudioStop()',
    'void StationheadHandleBase::ReleaseCompletedAuth()',
  ]) {
    const startAt = handleSource.indexOf(signature);
    assert.notEqual(startAt, -1, `missing method: ${signature}`);
    const body = handleSource.slice(startAt, startAt + 900);
    assert.match(body, /!startIssued_ \|\| stopIssued_/);
  }
});

test('assigning a fresh player resets the lifecycle and transition state', () => {
  const assign = section(
    handleSource,
    'void StationheadHandleBase::AssignPlayer(',
    'void StationheadHandleBase::ResetPlayer()',
  );
  assert.match(assign, /startIssued_ = false;/);
  assert.match(assign, /stopIssued_ = false;/);
  assert.match(assign, /playbackObserved_ = false;/);
  assert.match(assign, /playbackMissingSinceAt_ = 0;/);
  assert.match(assign, /transitionSuppressed_ = false;/);

  const reset = section(
    handleSource,
    'void StationheadHandleBase::ResetPlayer()',
    'bool StationheadHandleBase::HasAuthTabPlayer()',
  );
  assert.match(reset, /player_\.reset\(\);/);
  assert.match(reset, /startIssued_ = false;/);
  assert.match(reset, /stopIssued_ = false;/);
});

test('shared WebView environment completion isolates every consumer callback', () => {
  const helper = section(
    environmentSource,
    'void InvokeEnvironmentCompletionNoexcept(',
    '}  // namespace',
  );
  assert.match(helper, /try \{[\s\S]*completion\(result, environment\);/);
  assert.match(helper, /catch \(\.\.\.\)/);

  assert.match(
    environmentSource,
    /InvokeEnvironmentCompletionNoexcept\(\s*completion, S_OK, readyEnvironment\.Get\(\)\)/,
  );
  assert.match(
    environmentSource,
    /for \(auto& callback : callbacks\) \{\s*InvokeEnvironmentCompletionNoexcept\(callback, timeout, nullptr\);/,
  );
  assert.match(
    environmentSource,
    /for \(auto& callback : callbacks\) \{\s*InvokeEnvironmentCompletionNoexcept\(\s*callback, result, readyEnvironment\.Get\(\)\);/,
  );
});

test('shared environment creation converts native setup exceptions into HRESULT failures', () => {
  assert.match(environmentSource, /catch \(const std::bad_alloc&\)/);
  assert.match(
    environmentSource,
    /Complete\(requestedKey, creationGeneration, E_OUTOFMEMORY, nullptr\);/,
  );
  assert.match(environmentSource, /catch \(\.\.\.\)/);
  assert.match(
    environmentSource,
    /Complete\(requestedKey, creationGeneration, E_FAIL, nullptr\);/,
  );
});

test('accepted environment completion closes its generation before callbacks run', () => {
  const complete = section(
    environmentSource,
    'void SharedWebViewEnvironment::Complete(',
    '}  // namespace hp',
  );
  const generationCheckAt = complete.indexOf('if (entry.generation != generation) return;');
  const closeGenerationAt = complete.indexOf('++entry.generation;');
  const callbackSwapAt = complete.indexOf('callbacks.swap(entry.pending);');
  assert.ok(generationCheckAt >= 0);
  assert.ok(closeGenerationAt > generationCheckAt);
  assert.ok(callbackSwapAt > closeGenerationAt);
});
