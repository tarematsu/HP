import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/cloud_client_exchange.inc', import.meta.url), 'utf8');

test('Cloudflare exchange JSON avoids temporary literal concatenations', () => {
  assert.match(source, /body\.reserve\(512\)/);
  assert.match(source, /body\.reserve\(body\.size\(\) \+ telemetry->json\.size\(\) \+ 512\)/);
  assert.match(source, /body \+= leaderboardDiagnostics\.stage/);
  assert.match(source, /body \+= leaderboardDiagnostics\.lastSuccessStage/);
  assert.match(source, /body \+= leaderboardDiagnostics\.lastError/);
  assert.doesNotMatch(source, /body \+= "\\\\?"(?:dashboard|radar|switchbot|config)[^;]*\+ number/);
  assert.match(source, /stationhead_leaderboard_capture_spool::ReadBatchWithCount\(\)/);
  assert.match(source, /leaderboardSnapshot\.totalRecords/);
  assert.doesNotMatch(source, /stationhead_leaderboard_capture_spool::Count\(\)/);
  assert.match(source, /stationhead_leaderboard_capture_spool::Acknowledge\(leaderboardCapture, accepted\)/);
});

test('production Cloudflare exchange version encoder retains wire values and missing-key fallback', () => {
  const a = source.indexOf('  const auto number = [&](const wchar_t* name) {');
  const z = source.indexOf('  std::optional<PendingTelemetry> telemetry;', a);
  assert.ok(a >= 0 && z > a);
  const fragment = source.slice(a, z);
  const dir = mkdtempSync(join(tmpdir(), 'native-cloud-exchange-json-'));
  try {
    const input = join(dir, 'test.cpp');
    const executable = join(dir, process.platform === 'win32' ? 'test.exe' : 'test');
    writeFileSync(input, "#include <iostream>\n#include <string>\n#include <string_view>\nstd::wstring ExchangeQueryValue(const std::wstring& path, const wchar_t* key) {\n  const std::wstring marker = std::wstring(key) + L\"=\";\n  const size_t at = path.find(marker);\n  if (at == std::wstring::npos) return {};\n  const size_t from = at + marker.size();\n  const size_t to = path.find(L'&', from);\n  return path.substr(from, to == std::wstring::npos ? to : to - from);\n}\nstd::string WideToUtf8(const std::wstring& value) {\n  return std::string(value.begin(), value.end());\n}\nvoid report(const std::wstring& path) {\n" + fragment + "\n  (void)deviceId;\n  std::cout << body << \"}\" << '\\n';\n}\nint main() {\n  report(L\"/v1/device/sync?deviceId=home&dashboardVersion=3&radarVersion=7&switchbotVersion=9&configVersion=2\");\n  report(L\"/v1/device/sync?deviceId=home&dashboardVersion=-1&radarVersion=-1&switchbotVersion=-1&configVersion=0\");\n  report(L\"/v1/device/sync?deviceId=home&dashboardVersion=12&radarVersion=2&configVersion=7\");\n}\n");
    execFileSync('g++', ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror',
      input, '-o', executable]);
    const records = execFileSync(executable, { encoding: 'utf8' })
      .trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(records[0].versions,
      { dashboard: 3, radar: 7, switchbot: 9, config: 2 });
    assert.deepEqual(records[1].versions,
      { dashboard: -1, radar: -1, switchbot: -1, config: 0 });
    assert.deepEqual(records[2].versions,
      { dashboard: 12, radar: 2, switchbot: -1, config: 7 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
