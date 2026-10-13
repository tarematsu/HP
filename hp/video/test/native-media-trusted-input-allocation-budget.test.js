import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/renderer_panels/media_trusted_input.inc', import.meta.url),
  'utf8');

test('trusted YouTube and TVer mouse payload reuses a single reserved wide-string buffer', () => {
  const start = source.indexOf('std::wstring NativeMediaTrustedMouseParams(');
  const end = source.indexOf('double NativeMediaTrustedCssScale(', start);
  assert.ok(start >= 0 && end > start);
  const method = source.slice(start, end);
  assert.match(method, /params\.reserve\(128\)/);
  assert.match(method, /params \+= L"\\",\\"x\\":";\s*params \+= std::to_wstring\(x\)/);
  assert.match(method, /params \+= L",\\"y\\":";\s*params \+= std::to_wstring\(y\)/);
  assert.doesNotMatch(method, /std::to_wstring\(x\) \+/);
  assert.match(method, /std::wstring_view\(type\) == L"mouseReleased"/);
  assert.match(source, /L"Input\.dispatchMouseEvent"/);
});

test('compiled production CDP payload builder preserves coordinates and pressed/released semantics', () => {
  const start = source.indexOf('std::wstring NativeMediaTrustedMouseParams(');
  const end = source.indexOf('double NativeMediaTrustedCssScale(', start);
  assert.ok(start >= 0 && end > start);
  const fragment = source.slice(start, end);
  const directory = mkdtempSync(join(tmpdir(), 'native-cdp-input-budget-'));
  try {
    const input = join(directory, 'test.cpp');
    const executable = join(directory, process.platform === 'win32' ? 'test.exe' : 'test');
    writeFileSync(input, "#include <iostream>\n#include <string>\n#include <string_view>\n" + fragment + "\nint main() {\n  for (const auto& value : {\n      NativeMediaTrustedMouseParams(L\"mouseMoved\", 100.5, 66.25, false),\n      NativeMediaTrustedMouseParams(L\"mousePressed\", 100.5, 66.25, true),\n      NativeMediaTrustedMouseParams(L\"mouseReleased\", 100.5, 66.25, false)}) {\n    std::cout << std::string(value.begin(), value.end()) << '\\n';\n  }\n}\n");
    execFileSync('g++', ['-std=c++17', '-Wall', '-Wextra', '-Werror', input, '-o', executable]);
    const records = execFileSync(executable, { encoding: 'utf8' }).trim()
      .split('\n').map(line => JSON.parse(line));
    assert.deepEqual(records, [
      { type: 'mouseMoved', x: 100.5, y: 66.25 },
      { type: 'mousePressed', x: 100.5, y: 66.25,
        button: 'left', buttons: 1, clickCount: 1 },
      { type: 'mouseReleased', x: 100.5, y: 66.25,
        button: 'left', buttons: 0, clickCount: 1 },
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
