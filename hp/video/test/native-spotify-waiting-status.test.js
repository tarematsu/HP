import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const scripts = readFileSync(
  new URL('../../native/src/spotify_static_scripts.inc', import.meta.url),
  'utf8',
);
const header = readFileSync(
  new URL('../../native/src/spotify_webviews.h', import.meta.url),
  'utf8',
);

test('waiting Spotify account shows 待機中 instead of a stale track title', () => {
  assert.match(header, /SpotifyAccountShouldOwnHost\(size_t accountIndex\)/);
  assert.match(
    scripts,
    /if \(!SpotifyAccountShouldOwnHost\(i\)\) \{[\s\S]*result\[i\]\.trackTitle = L"待機中";[\s\S]*result\[i\]\.confirmed = false;[\s\S]*continue;/,
  );
  assert.match(
    scripts,
    /result\[i\]\.trackTitle = slots_\[i\]\.processTrackDisplay;/,
  );
});
