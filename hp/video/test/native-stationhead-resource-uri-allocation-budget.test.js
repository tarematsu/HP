import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const shared = readFileSync(new URL('../../native/src/sh_shared.h', import.meta.url), 'utf8');
const scriptPolicy = readFileSync(new URL('../../native/src/sh_polling_policy.h', import.meta.url), 'utf8');
const scriptExtra = readFileSync(new URL('../../native/src/sh_script_blocking_extension.h', import.meta.url), 'utf8');
const activePolicy = readFileSync(new URL('../../native/src/sh_runtime_script_resource_policy_fix.h', import.meta.url), 'utf8');
const webview = readFileSync(new URL('../../native/src/sh_webview.cpp', import.meta.url), 'utf8');
const cmake = readFileSync(new URL('../../native/CMakeLists.txt', import.meta.url), 'utf8');

test('the single active Stationhead resource callback is allocation-free and explicitly selected', () => {
  assert.match(webview, /#include "sh_runtime_script_resource_policy_fix\.h"/);
  assert.match(webview, /ApplyStationheadResourceBlockingScriptFixed\(/);
  const active = activePolicy.slice(activePolicy.indexOf('inline void ApplyStationheadResourceBlockingScriptFixed('));
  assert.equal((active.match(/add_WebResourceRequested\(/g) || []).length, 1);
  assert.match(active, /StationheadLowerAsciiInPlace\(uriRaw\)/);
  assert.match(active, /const std::wstring_view lower\(uriRaw\)/);
  assert.match(active, /StationheadKnownOptionalModuleStubBoundaryFixed\(lower\)/);
  assert.match(active, /StationheadExpandedNonPlaybackScriptBoundaryFixed\(lower\)/);
  assert.match(active, /StationheadCorePlaybackRequestBoundaryFixed\(lower\)/);
  assert.match(active, /CoTaskMemFree\(uriRaw\)/);
  assert.doesNotMatch(active, /lower = StationheadLowerAscii\(uriRaw\)/);
  for (const source of [shared, scriptPolicy, scriptExtra, activePolicy]) {
    assert.doesNotMatch(source, /#(?:define|undef) ApplyStationheadResourceBlocking/);
  }
  assert.doesNotMatch(shared, /add_WebResourceRequested\(/);
  assert.doesNotMatch(scriptPolicy, /add_WebResourceRequested\(/);
  assert.doesNotMatch(scriptExtra, /add_WebResourceRequested\(/);
  assert.match(cmake, /src\/sh_runtime_script_resource_policy_fix\.h/);
});

test('compiled resource policy matches previous ASCII case-folding, telemetry blocking and Spotify audio allowlist', () => {
  const legacyStart = shared.indexOf('inline std::wstring StationheadLowerAscii(');
  const inPlaceStart = shared.indexOf('inline void StationheadLowerAsciiInPlace(');
  const apiStart = shared.indexOf('inline std::wstring_view StationheadProductionApiPath(');
  const policyEnd = shared.indexOf('// Block only known telemetry sockets.', apiStart);
  assert.ok(legacyStart >= 0 && inPlaceStart > legacyStart &&
    apiStart > inPlaceStart && policyEnd > apiStart);
  const legacy = shared.slice(legacyStart, inPlaceStart);
  const inPlace = shared.slice(inPlaceStart, shared.indexOf('// True for requests', inPlaceStart));
  const policy = shared.slice(apiStart, policyEnd);
  assert.match(policy, /StationheadRequestIsBlockable\(std::wstring_view uriLower\)/);
  assert.match(policy, /StationheadCorePlaybackRequest\(std::wstring_view uriLower\)/);
  const directory = mkdtempSync(join(tmpdir(), 'sh-uri-budget-'));
  try {
    const file = join(directory, 'policy.cpp');
    const executable = join(directory, process.platform === 'win32' ? 'policy.exe' : 'policy');
    writeFileSync(file, "#include <cassert>\n#include <string>\n#include <string_view>\n#include <vector>\n" + legacy + inPlace + policy + "\nint main() {\n  std::vector<std::wstring> urls{\n    L\"HTTPS://PRODUCTION1.STATIONHEAD.COM/CHATHistory?page=1\",\n    L\"https://production1.stationhead.com/pusher/presenceAuth\",\n    L\"https://production1.stationhead.com/channels/alias/buddies/listener\",\n    L\"https://production1.stationhead.com/station/abc/listener\",\n    L\"https://www.google-ANALYTICS.com/collect\",\n    L\"https://p.SCDN.co/audio/track\",\n    L\"https://cdn.example.com/ARTWORK.PNG\",\n    L\"https://production1.stationhead.com/plus/status\",\n    L\"https://example.com/keep.mp3\"\n  };\n  for (auto& url : urls) {\n    const std::wstring expected = StationheadLowerAscii(url.c_str());\n    StationheadLowerAsciiInPlace(url.data());\n    assert(url == expected);\n  }\n  StationheadLowerAsciiInPlace(nullptr);\n  assert(StationheadRequestIsBlockable(urls[0]));\n  assert(!StationheadRequestIsBlockable(urls[1]));\n  assert(!StationheadRequestIsBlockable(urls[2]));\n  assert(StationheadRequestIsBlockable(urls[3]));\n  assert(StationheadRequestIsBlockable(urls[4]));\n  assert(StationheadCorePlaybackRequest(urls[1]));\n  assert(StationheadCorePlaybackRequest(urls[2]));\n  assert(StationheadCorePlaybackRequest(urls[5]));\n  assert(StationheadRequestLooksLikeImage(urls[6]));\n  assert(StationheadRequestIsBlockable(urls[7]));\n  assert(!StationheadCorePlaybackRequest(urls[8]));\n  assert(!StationheadRequestIsBlockable(urls[8]));\n  std::wstring buffer = L\"HTTPS://P.SCDN.CO/TRACK\";\n  const wchar_t* const identity = buffer.data();\n  StationheadLowerAsciiInPlace(buffer.data());\n  assert(buffer.data() == identity);\n  assert(buffer == L\"https://p.scdn.co/track\");\n  assert(StationheadCorePlaybackRequest(buffer));\n}\n");
    execFileSync('g++', ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror',
      file, '-o', executable]);
    execFileSync(executable);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
