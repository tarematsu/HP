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


test('cloud exchange decodes binary JSON without an intermediate UTF-8 string copy', () => {
  const begin = source.indexOf('std::wstring ExchangeJsonUtf8ToWide(');
  const end = source.indexOf('}  // namespace', begin);
  assert.ok(begin >= 0 && end > begin);
  const helper = source.slice(begin, end);
  assert.match(helper, /MultiByteToWideChar\(\s*CP_UTF8, MB_ERR_INVALID_CHARS/);
  assert.match(helper, /length > static_cast<size_t>\(std::numeric_limits<int>::max\(\)\)/);
  assert.match(helper, /output\.data\(\), wideLength\)/);
  assert.match(source, /JsonObject::Parse\(\s*ExchangeJsonUtf8ToWide\(translated\.body\.data\(\), translated\.body\.size\(\)\)\)/);
  assert.doesNotMatch(source, /Utf8ToWide\(std::string\(/);
  const directory = mkdtempSync(join(tmpdir(), 'native-exchange-decoder-'));
  try {
    const input = join(directory, 'test.cpp');
    const executable = join(directory, process.platform === 'win32' ? 'test.exe' : 'test');
    writeFileSync(input, "#include <cassert>\n#include <cstdint>\n#include <iostream>\n#include <limits>\n#include <stdexcept>\n#include <string>\nusing std::size_t;\nconstexpr int CP_UTF8 = 65001;\nconstexpr int MB_ERR_INVALID_CHARS = 8;\nint MultiByteToWideChar(int codepage, int flags, const char* bytes, int n, wchar_t* dest, int cap) {\n  assert(codepage == CP_UTF8 && flags == MB_ERR_INVALID_CHARS);\n  if (!bytes || n <= 0) return 0;\n  // Synthetic Win32 boundary for these ASCII / malformed-UTF8 fixtures.\n  for (int i = 0; i < n; ++i) if (static_cast<unsigned char>(bytes[i]) >= 128) return 0;\n  if (!dest) return n;\n  if (cap < n) return 0;\n  for (int i = 0; i < n; ++i) dest[i] = static_cast<unsigned char>(bytes[i]);\n  return n;\n}\n" + helper + "\nint main() {\n  const char json[] = \"{\\\"versions\\\":{\\\"dashboard\\\":3}}\";\n  const auto wide = ExchangeJsonUtf8ToWide(\n      reinterpret_cast<const uint8_t*>(json), sizeof(json) - 1);\n  assert(wide == L\"{\\\"versions\\\":{\\\"dashboard\\\":3}}\");\n  bool threw = false;\n  try { (void)ExchangeJsonUtf8ToWide(nullptr, 0); }\n  catch (const std::runtime_error&) { threw = true; }\n  assert(threw);\n  const uint8_t malformed[] = {0xFF};\n  threw = false;\n  try { (void)ExchangeJsonUtf8ToWide(malformed, 1); }\n  catch (const std::runtime_error&) { threw = true; }\n  assert(threw);\n}\n");
    execFileSync('g++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', input, '-o', executable]);
    execFileSync(executable);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
