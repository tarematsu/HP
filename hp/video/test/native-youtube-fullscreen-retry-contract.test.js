import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mvPanel = readFileSync(
  new URL('../../native/src/renderer_panels/mv_section.inc', import.meta.url),
  'utf8',
);

test('YouTube fullscreen waits for the watch page and retries until fullscreen is confirmed', () => {
  assert.match(
    mvPanel,
    /void ProbeFullscreenButton\(\) noexcept \{[\s\S]*!IsWatchPage\(\)\) return;/,
  );
  assert.match(mvPanel, /document\.fullscreenElement/);
  assert.match(mvPanel, /classList\.contains\('ytp-fullscreen'\)/);
  assert.match(mvPanel, /return 'fullscreen';/);
  assert.match(
    mvPanel,
    /std::wstring_view\(json\) == L"\\\"fullscreen\\\""[\s\S]*StopFullscreenProbe\(\)/,
  );
  assert.match(
    mvPanel,
    /ParseNormalizedPoint\(json, &x, &y\)[\s\S]*ClickNormalizedPoint\(x, y\);[\s\S]*return S_OK;/,
  );
  assert.doesNotMatch(
    mvPanel,
    /ParseNormalizedPoint\(json, &x, &y\)\) \{\s*StopFullscreenProbe\(\);\s*ClickNormalizedPoint/,
  );
  assert.match(mvPanel, /kNativeMvFullscreenRetryMs = 500U/);
  assert.match(mvPanel, /kNativeMvFullscreenRetryLimit = 30/);
});
