import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { inferVideoDimensions } from '../src/video-orientation.js';

const source = await readFile(new URL('../src/video-orientation.js', import.meta.url), 'utf8');

test('video dimensions retain the final adjacent segment without URL or match arrays', () => {
  assert.deepEqual(
    inferVideoDimensions('https://video.twimg.com/path/640x360/720x1280/video.mp4?tag=1'),
    { width: 720, height: 1280 }
  );
  assert.equal(inferVideoDimensions('not-an-absolute-url/720x1280/video.mp4'), null);
  assert.match(source, /VIDEO_DIMENSION_SEGMENT\.exec\(pathname\)/);
  assert.doesNotMatch(source, /new URL\(/);
  assert.doesNotMatch(source, /\[\.\.\.pathname\.matchAll/);
  assert.doesNotMatch(source, /matches\.at\(-1\)/);
});
