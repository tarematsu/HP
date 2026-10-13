import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/cloud_client_http.cpp', import.meta.url), 'utf8');

test('native Cloudflare HTTP header builder reuses a reserved buffer', () => {
  const begin = source.indexOf('    std::wstring headers;');
  const end = source.indexOf('    const BOOL sent = WinHttpSendRequest(', begin);
  assert.ok(begin >= 0 && end > begin);
  const builder = source.slice(begin, end);
  assert.match(builder, /headers\.reserve\(96 \+ token\.size\(\) \+ etag\.size\(\)/);
  assert.match(builder, /headers \+= L"Authorization: Bearer ";\s*headers \+= token;/);
  assert.match(builder, /headers \+= L"If-None-Match: ";\s*headers \+= etag;/);
  assert.match(builder, /headers \+= L"Content-Type: ";\s*headers \+= contentType;/);
  assert.doesNotMatch(builder, /\+ token \+ L"\\r\\n"/);
  assert.doesNotMatch(builder, /std::wstring\(L"Content-Type: "\) \+ contentType/);
  const directory = mkdtempSync(join(tmpdir(), 'native-http-header-buffer-'));
  try {
    const file = join(directory, 'header.cpp');
    const executable = join(directory, process.platform === 'win32' ? 'header.exe' : 'header');
    writeFileSync(file, "#include <cassert>\n#include <string>\n#include <utility>\nstd::wstring Build(const std::wstring& token, const std::wstring& etag,\n                   const std::string& body, const wchar_t* contentType) {\n" + builder + "\n  return headers;\n}\nint main() {\n  assert(Build(L\"\", L\"\", \"\", L\"application/json\") ==\n         L\"Accept-Encoding: gzip\\r\\n\");\n  assert(Build(L\"secret\", L\"\", \"\", L\"application/json\") ==\n         L\"Accept-Encoding: gzip\\r\\nAuthorization: Bearer secret\\r\\n\");\n  assert(Build(L\"\", L\"\\\"rev-7\\\"\", \"\", L\"application/json\") ==\n         L\"Accept-Encoding: gzip\\r\\nIf-None-Match: \\\"rev-7\\\"\\r\\n\");\n  assert(Build(L\"long-secret\", L\"42\", \"{}\", L\"application/json\") ==\n         L\"Accept-Encoding: gzip\\r\\n\"\n         L\"Authorization: Bearer long-secret\\r\\n\"\n         L\"If-None-Match: 42\\r\\n\"\n         L\"Content-Type: application/json\\r\\n\");\n  assert(Build(L\"\", L\"\", \"a\", L\"text/plain; charset=utf-8\") ==\n         L\"Accept-Encoding: gzip\\r\\n\"\n         L\"Content-Type: text/plain; charset=utf-8\\r\\n\");\n}\n");
    execFileSync('g++', ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror',
      file, '-o', executable]);
    execFileSync(executable);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
