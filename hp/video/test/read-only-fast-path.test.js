import assert from 'node:assert/strict';
import test from 'node:test';

import entry from '../src/entry.js';

test('GET requests do not touch the shared cache binding', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  Object.defineProperty(globalThis, 'caches', {
    configurable: true,
    get() {
      throw new Error('read-only requests must not access caches.default');
    }
  });

  try {
    const response = await entry.fetch(
      new Request('https://example.com/'),
      {
        MEDIA_HOST: 'video.twimg.com',
        ASSETS: {
          async fetch() {
            return new Response('ok');
          }
        }
      },
      {}
    );

    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'ok');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'caches', previous);
    else delete globalThis.caches;
  }
});
