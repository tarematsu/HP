import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const source = readFileSync(
  new URL('../../native/src/stationhead_leaderboard_capture_spool.h', import.meta.url), 'utf8');

test('Stationhead leaderboard capture converts the bounded view without a UTF-16 copy', () => {
  const begin = source.indexOf('inline std::string CapturePayloadUtf8(');
  const end = source.indexOf('inline bool Append(', begin);
  assert.ok(begin > 0 && end > begin);
  const converter = source.slice(begin, end);
  const append = source.slice(end, source.indexOf('struct UploadSnapshot', end));
  assert.match(converter, /std::wstring_view payload/);
  assert.match(converter, /WideCharToMultiByte\(\s*CP_UTF8, WC_ERR_INVALID_CHARS/);
  assert.match(converter, /outputLength\) > kMaxCaptureRecordBytes/);
  assert.match(append, /const std::string utf8 = CapturePayloadUtf8\(payload\)/);
  assert.match(append, /utf8\.find\('\\r'\)/);
  assert.match(append, /utf8\.find\('\\n'\)/);
  assert.match(append, /WriteLinesLocked\(lines\)/);
  assert.doesNotMatch(append, /WideToUtf8\(std::wstring\(payload\)\)/);
});

test('compiled leaderboard UTF-8 converter retains size limit and strict encoding', () => {
  const begin = source.indexOf('inline std::string CapturePayloadUtf8(');
  const end = source.indexOf('inline bool Append(', begin);
  assert.ok(begin > 0 && end > begin);
  const directory = mkdtempSync(join(tmpdir(), 'stationhead-capture-utf8-'));
  try {
    const filename = join(directory, 'capture.cpp');
    const exe = join(directory, process.platform === 'win32' ? 'capture.exe' : 'capture');
    writeFileSync(filename, "#include <cassert>\n#include <cstddef>\n#include <cstdint>\n#include <cstring>\n#include <string>\n#include <string_view>\nconstexpr size_t kMaxCaptureRecordBytes = 72 * 1024;\nconstexpr unsigned CP_UTF8 = 65001;\nconstexpr unsigned WC_ERR_INVALID_CHARS = 0x80;\nint WideCharToMultiByte(unsigned codePage, unsigned flags,\n                        const wchar_t* input, int length, char* output,\n                        int capacity, const char*, bool*) {\n  assert(codePage == CP_UTF8 && flags == WC_ERR_INVALID_CHARS);\n  if (!input || length <= 0) return 0;\n  std::string encoded;\n  for (int i = 0; i < length; ++i) {\n    const uint32_t cp = static_cast<uint32_t>(input[i]);\n    if (cp >= 0xd800 && cp <= 0xdfff) return 0;\n    if (cp <= 0x7f) encoded.push_back(static_cast<char>(cp));\n    else if (cp <= 0x7ff) {\n      encoded.push_back(static_cast<char>(0xc0 | (cp >> 6)));\n      encoded.push_back(static_cast<char>(0x80 | (cp & 0x3f)));\n    } else if (cp <= 0xffff) {\n      encoded.push_back(static_cast<char>(0xe0 | (cp >> 12)));\n      encoded.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3f)));\n      encoded.push_back(static_cast<char>(0x80 | (cp & 0x3f)));\n    } else return 0;\n  }\n  if (!output) return static_cast<int>(encoded.size());\n  if (capacity < static_cast<int>(encoded.size())) return 0;\n  std::memcpy(output, encoded.data(), encoded.size());\n  return static_cast<int>(encoded.size());\n}\n" + source.slice(begin, end) + "\nint main() {\n  assert(CapturePayloadUtf8(L\"{\\\"name\\\":\\\"Buddies\\\"}\") == \"{\\\"name\\\":\\\"Buddies\\\"}\");\n  assert(CapturePayloadUtf8(L\"{\\\"name\\\":\\\"日本\\\"}\") ==\n    std::string(\"{\\\"name\\\":\\\"\") + \"\\xe6\\x97\\xa5\\xe6\\x9c\\xac\" + \"\\\"}\");\n  assert(CapturePayloadUtf8({}).empty());\n  std::wstring maximum(kMaxCaptureRecordBytes, L'x');\n  assert(CapturePayloadUtf8(maximum).size() == kMaxCaptureRecordBytes);\n  maximum.push_back(L'x');\n  assert(CapturePayloadUtf8(maximum).empty());\n  std::wstring expanded(25'000, L'日');\n  assert(CapturePayloadUtf8(expanded).empty());\n  std::wstring invalid(1, static_cast<wchar_t>(0xd800));\n  assert(CapturePayloadUtf8(invalid).empty());\n}\n");
    execFileSync('g++', ['-std=c++20', '-O2', '-Wall', '-Wextra', '-Werror', filename, '-o', exe]);
    execFileSync(exe);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
