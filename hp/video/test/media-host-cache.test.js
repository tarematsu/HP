import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMediaHost } from '../src/media-host.js';

test('media host normalization is reused for the same configured value', () => {
  let conversions = 0;
  const configuredHost = {
    toString() {
      conversions += 1;
      return 'VIDEO.TWIMG.COM';
    }
  };
  const env = { MEDIA_HOST: configuredHost };

  assert.equal(resolveMediaHost(env), 'video.twimg.com');
  assert.equal(resolveMediaHost(env), 'video.twimg.com');
  assert.equal(conversions, 1);
});
