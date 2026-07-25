import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const loggerSource = readFileSync(
  new URL('../../native/src/logger.cpp', import.meta.url),
  'utf8',
);

test('native URL redaction accepts mixed-case HTTP schemes', () => {
  assert.match(
    loggerSource,
    /size_t FindHttpUrlStartCaseInsensitive\([\s\S]*_wcsnicmp\([\s\S]*kHttps[\s\S]*_wcsnicmp\([\s\S]*kHttp/,
  );
  assert.match(
    loggerSource,
    /const size_t caseInsensitiveAt =[\s\S]*FindHttpUrlStartCaseInsensitive\(sanitized, searchAt\);/,
  );
  assert.match(loggerSource, /sanitized\.find_first_of\(L"\?#", urlAt\)/);
  assert.match(loggerSource, /sanitized\.replace\(sensitiveAt, urlEnd - sensitiveAt, marker\)/);
});
