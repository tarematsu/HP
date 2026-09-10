import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const wrapper = readFileSync(
  new URL('../../native/src/renderer_panels/media_section.inc', import.meta.url),
  'utf8',
);
const host = readFileSync(
  new URL('../../native/src/renderer_panels/media_host.inc', import.meta.url),
  'utf8',
);

test('media panel hides the built-in WebView error page while retrying', () => {
  assert.match(
    wrapper,
    /#define put_IsBuiltInErrorPageEnabled\(value\) put_IsBuiltInErrorPageEnabled\(FALSE\)/,
  );
  assert.match(wrapper, /#undef put_IsBuiltInErrorPageEnabled/);
  assert.match(host, /if \(FAILED\(args->get_IsSuccess\(&succeeded\)\) \|\| !succeeded\)/);
  assert.match(
    host,
    /StopYoutubeMonitors\(\);[\s\S]*StopTverPlaybackMonitor\(\);[\s\S]*ScheduleNavigationRetry\(\);/,
  );
});
