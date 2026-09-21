import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = name => readFileSync(new URL(`../../native/src/${name}`, import.meta.url), 'utf8');
const handleHeader = source('app_stationhead_handles.h');
const handles = source('app_stationhead_handles.cpp');
const environment = source('shared_webview_environment.cpp');

function section(text, start, end) {
  const from = text.indexOf(start);
  assert.notEqual(from, -1, `missing section: ${start}`);
  const to = text.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `missing section terminator: ${end}`);
  return text.slice(from, to);
}

test('Stationhead handle owns a one-way startup lifecycle', () => {
  assert.match(handleHeader, /bool startIssued_ = false;/);
  assert.match(handleHeader, /bool stopIssued_ = false;/);
  const start = section(handles, 'void StationheadHandleBase::Start() {',
    'void StationheadHandleBase::Tick(');
  assert.match(start, /startIssued_ \|\| stopIssued_/);
  assert.ok(start.indexOf('startIssued_ = true;') < start.indexOf('player_->Start();'));

  const stop = section(handles, 'void StationheadHandleBase::Stop() {',
    'void StationheadHandleBase::SetAudioMuted(');
  assert.match(stop, /if \(startIssued_\) player_->Stop\(\);/);
});

test('stopped players cannot receive active handle work', () => {
  for (const signature of [
    'void StationheadHandleBase::Tick(',
    'void StationheadHandleBase::ShowAfterAudioStop()',
    'void StationheadHandleBase::ReleaseCompletedAuth()',
  ]) {
    const at = handles.indexOf(signature);
    assert.notEqual(at, -1, `missing method: ${signature}`);
    assert.match(handles.slice(at, at + 500), /!startIssued_ \|\| stopIssued_/);
  }
});

test('fresh player assignment resets lifecycle state', () => {
  const assign = section(handles, 'void StationheadHandleBase::AssignPlayer(',
    'void StationheadHandleBase::ResetPlayer()');
  assert.match(assign, /startIssued_ = false;/);
  assert.match(assign, /playbackObserved_ = false;/);

  const reset = section(handles, 'void StationheadHandleBase::ResetPlayer()',
    'bool StationheadHandleBase::IsInteractive(');
  assert.match(reset, /player_\.reset\(\)/);
  assert.match(reset, /startIssued_ = false;/);
});

test('shared WebView environment isolates consumer callbacks', () => {
  const helper = section(environment, 'void InvokeEnvironmentCompletionNoexcept(',
    '}  // namespace');
  assert.match(helper, /try \{[\s\S]*completion\(result, environment\)/);
  assert.match(helper, /catch \(\.\.\.\)/);
});

test('shared environment creation converts setup exceptions into failures', () => {
  const acquire = section(environment, 'void SharedWebViewEnvironment::Acquire(',
    'void SharedWebViewEnvironment::Invalidate(');
  assert.ok((acquire.match(/catch \(const std::bad_alloc&\)/g) || []).length >= 2);
  assert.match(acquire, /E_OUTOFMEMORY/);
  assert.match(acquire, /E_FAIL/);
});

test('accepted environment completion closes its generation before callbacks', () => {
  const complete = section(environment, 'void SharedWebViewEnvironment::Complete(',
    '}  // namespace hp');
  assert.ok(
    complete.indexOf('if (entry.generation != generation) return;') <
      complete.indexOf('++entry.generation;'),
  );
  assert.ok(complete.indexOf('++entry.generation;') <
    complete.indexOf('callbacks.swap(entry.pending);'));
});
