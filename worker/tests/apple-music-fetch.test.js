import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAppleMusicFetch,
  prioritizeAppleMusicBundles,
} from '../src/apple-music-fetch.js';

test('Apple Music bootstrap prioritizes index~ bundles before unrelated scripts', () => {
  const html = [
    '<script src="/assets/chunk-a.js"></script>',
    '<script src="/assets/vendor.js"></script>',
    '<script src="/assets/index~abc123.js"></script>',
  ].join('');
  const prioritized = prioritizeAppleMusicBundles(html);
  assert.ok(prioritized.indexOf('/assets/index~abc123.js') < prioritized.indexOf('/assets/chunk-a.js'));
});

test('Apple Music fetch uses the current root bootstrap and preserves token bundles', async () => {
  const calls = [];
  const fakeFetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://music.apple.com/') {
      return new Response('<script src="/assets/index~live.js"></script>', { status: 200 });
    }
    throw new Error(`unexpected URL: ${url}`);
  };

  const wrapped = createAppleMusicFetch(fakeFetch);
  const response = await wrapped('https://music.apple.com/us/browse');
  const html = await response.text();
  assert.deepEqual(calls, ['https://music.apple.com/']);
  assert.match(html, /index~live\.js/u);
});

test('Apple Music API retries authorization failures with Apple-compatible origin headers', async () => {
  const calls = [];
  const fakeFetch = async (input, init = {}) => {
    const headers = new Headers(init.headers || undefined);
    calls.push({ url: String(input), origin: headers.get('origin'), referer: headers.get('referer') });
    return new Response('{}', { status: calls.length === 1 ? 403 : 200 });
  };

  const wrapped = createAppleMusicFetch(fakeFetch);
  const response = await wrapped('https://api.music.apple.com/v1/catalog/jp/artists/1541126420/view/top-songs', {
    headers: {
      authorization: 'Bearer token',
      origin: 'https://music.apple.com',
      referer: 'https://music.apple.com/jp/artist/-/1541126420',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].origin, 'https://apple.com');
  assert.equal(calls[1].referer, 'https://music.apple.com/');
});
