import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const helpers = readFileSync(
  new URL('../../native/src/cloud_client_exchange_helpers.inc', import.meta.url), 'utf8');

test('cloud exchange parses version keys in place without a temporary token allocation', () => {
  const begin = helpers.indexOf('std::wstring ExchangeQueryValue(');
  const end = helpers.indexOf('uint32_t ExchangeReadUint32(', begin);
  assert.ok(begin >= 0 && end > begin);
  const query = helpers.slice(begin, end);
  assert.match(query, /const size_t keyLength = std::char_traits<wchar_t>::length\(name\)/);
  assert.match(query, /path\.compare\(start, keyLength, name, keyLength\) == 0/);
  assert.match(query, /path\[start \+ keyLength\] == L'='/);
  assert.doesNotMatch(query, /std::wstring\(name\) \+ L"="/);
  assert.doesNotMatch(query, /std::wstring token/);
});

test('compiled native cloud parser preserves exact key, missing, duplicate and empty-value handling', () => {
  const begin = helpers.indexOf('std::wstring ExchangeQueryValue(');
  const end = helpers.indexOf('uint32_t ExchangeReadUint32(', begin);
  assert.ok(begin >= 0 && end > begin);
  const dir = mkdtempSync(join(tmpdir(), 'cloud-query-inplace-'));
  try {
    const filename = join(dir, 'test.cpp');
    const exe = join(dir, process.platform === 'win32' ? 'test.exe' : 'test');
    writeFileSync(filename, "#include <cassert>\n#include <string>\n" + helpers.slice(begin, end) + "\nint main() {\n  const std::wstring path =\n      L\"/v1/device/sync?deviceId=home&dashboardVersion=3&\"\n      L\"radarVersion=-1&switchbotVersion=9&configVersion=2\";\n  assert(ExchangeQueryValue(path, L\"deviceId\") == L\"home\");\n  assert(ExchangeQueryValue(path, L\"dashboardVersion\") == L\"3\");\n  assert(ExchangeQueryValue(path, L\"radarVersion\") == L\"-1\");\n  assert(ExchangeQueryValue(path, L\"switchbotVersion\") == L\"9\");\n  assert(ExchangeQueryValue(path, L\"configVersion\") == L\"2\");\n  assert(ExchangeQueryValue(path, L\"radar\") == L\"\");\n  assert(ExchangeQueryValue(path, L\"radarVersionX\") == L\"\");\n  assert(ExchangeQueryValue(L\"/path\", L\"deviceId\").empty());\n  assert(ExchangeQueryValue(\n      L\"/path?dashboardVersionExtra=12&dashboardVersion=4\", L\"dashboardVersion\") == L\"4\");\n  assert(ExchangeQueryValue(\n      L\"/path?dashboardVersion&dashboardVersion=8\", L\"dashboardVersion\") == L\"8\");\n  assert(ExchangeQueryValue(\n      L\"/path?dashboardVersion=&dashboardVersion=5\", L\"dashboardVersion\").empty());\n  assert(ExchangeQueryValue(\n      L\"/path?dashboardVersion=1&dashboardVersion=2\", L\"dashboardVersion\") == L\"1\");\n  assert(ExchangeQueryValue(\n      L\"/path?other=value&deviceId=last\", L\"deviceId\") == L\"last\");\n}\n");
    execFileSync('g++', ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror',
      filename, '-o', exe]);
    execFileSync(exe);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
