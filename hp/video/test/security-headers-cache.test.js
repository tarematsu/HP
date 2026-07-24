import assert from 'node:assert/strict';
import test from 'node:test';

import { withSecurityHeaders } from '../src/security-headers.js';

function policyFor(mediaHost) {
  return withSecurityHeaders(new Response('ok'), { MEDIA_HOST: mediaHost })
    .headers
    .get('content-security-policy');
}

test('security policy cache follows the configured media host', () => {
  const first = policyFor('video.example.test');
  const second = policyFor('cdn.example.test');
  const firstAgain = policyFor('video.example.test');

  assert.match(first, /media-src 'self' https:\/\/video\.example\.test blob:/);
  assert.match(first, /connect-src 'self' https:\/\/video\.example\.test/);
  assert.match(second, /media-src 'self' https:\/\/cdn\.example\.test blob:/);
  assert.equal(firstAgain, first);
});
