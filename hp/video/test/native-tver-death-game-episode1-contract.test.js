import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const composition = readFileSync(
  new URL('../../native/src/renderer_panels.cpp', import.meta.url),
  'utf8',
);

test('Death Youth Game follows the published series-item queue', () => {
  assert.match(composition, /deathGameSeriesPath = '\/series\/srkzm5wbvp'/);
  assert.match(composition, /rememberSeriesPath\(seriesPath\)/);
  assert.match(composition, /writeEpisodeQueue\(seriesPath, hrefs, 0\)/);
  assert.match(composition, /location\.replace\(hrefs\[0\]\)/);
  assert.doesNotMatch(composition, /const isPreview = link/);
});
