import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const updater = readFileSync(
  new URL('../../native/src/updater.cpp', import.meta.url),
  'utf8',
);

function section(start, end) {
  const from = updater.indexOf(start);
  const to = updater.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing start marker: ${start}`);
  assert.ok(to > from, `missing end marker: ${end}`);
  return updater.slice(from, to);
}

test('updater captures exact WebView2 descendant handles before closing HomePanel', () => {
  const stop = section(
    'void EnsureHomePanelStopped(DWORD pid, const fs::path& root)',
    'bool LaunchRunner(',
  );
  const capture = stop.indexOf('CaptureWebView2Descendants(pid)');
  const close = stop.indexOf('RequestHomePanelExit(pid)');
  assert.ok(capture >= 0 && close > capture);
  assert.match(updater, /CreateToolhelp32Snapshot\(TH32CS_SNAPPROCESS, 0\)/);
  assert.match(updater, /th32ParentProcessID/);
  assert.match(updater, /_wcsicmp\(candidate\.executableName\.c_str\(\), L"msedgewebview2\.exe"\)/);
  assert.match(updater, /PROCESS_TERMINATE \| PROCESS_QUERY_LIMITED_INFORMATION/);
  assert.match(updater, /ProcessBaseNameMatches\(process, L"msedgewebview2\.exe"\)/);
});

test('updater drains captured WebView2 processes after graceful and forced app exit', () => {
  const stop = section(
    'void EnsureHomePanelStopped(DWORD pid, const fs::path& root)',
    'bool LaunchRunner(',
  );
  assert.match(
    stop,
    /if \(graceful == WAIT_OBJECT_0\) \{[\s\S]*EnsureTrackedWebViewProcessesStopped\(webViewProcesses, root\);[\s\S]*return;/,
  );
  assert.match(
    stop,
    /TerminateProcess\(terminator\.value, 1\)[\s\S]*EnsureTrackedWebViewProcessesStopped\(webViewProcesses, root\);/,
  );
});

test('WebView2 cleanup waits before terminating and never reopens by PID', () => {
  const drain = section(
    'void EnsureTrackedWebViewProcessesStopped(',
    'void EnsureHomePanelStopped(',
  );
  assert.match(drain, /kWebView2GracefulExitTimeoutMs/);
  assert.match(drain, /WaitForSingleObject\(child\.process\.value, 0\)/);
  assert.match(drain, /TerminateProcess\(child\.process\.value, 1\)/);
  assert.match(drain, /WaitForSingleObject\(child\.process\.value, kForcedExitTimeoutMs\)/);
  assert.doesNotMatch(drain, /OpenProcess/);
});
