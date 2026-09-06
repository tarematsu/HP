import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tverStatic = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_ad_guard.inc', import.meta.url),
  'utf8',
);

test('Death Youth Game follows the published series-item queue', () => {
  assert.match(tverStatic, /deathGameSeriesPath = '\/series\/srkzm5wbvp'/);
  assert.match(tverStatic, /rememberSeriesPath\(seriesPath\)/);
  assert.match(tverStatic, /writeEpisodeQueue\(seriesPath, hrefs, 0\)/);
  assert.match(tverStatic, /location\.replace\(hrefs\[0\]\)/);
  assert.doesNotMatch(tverStatic, /const isPreview = link/);
});
