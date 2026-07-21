import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectionCaptureEnabled,
  collectionCaptureLimits,
  isTextCaptureContentType,
  sanitizeHeaders
} from '../src/collection-capture.js';

test('collection capture can be disabled by environment flag', () => {
  assert.equal(collectionCaptureEnabled({}), true);
  assert.equal(collectionCaptureEnabled({ COLLECTION_CAPTURE_ENABLED: 'false' }), false);
  assert.equal(collectionCaptureEnabled({ COLLECTION_CAPTURE_ENABLED: '0' }), false);
  assert.equal(collectionCaptureEnabled({ COLLECTION_CAPTURE_ENABLED: 'off' }), false);
});

test('collection capture limits are clamped', () => {
  assert.deepEqual(collectionCaptureLimits({
    COLLECTION_CAPTURE_NETWORK_LIMIT: '999999',
    COLLECTION_CAPTURE_BODY_LIMIT: '999999',
    COLLECTION_CAPTURE_HTML_LIMIT: '9999999'
  }), {
    networkLimit: 2000,
    bodyLimit: 262_144,
    htmlLimit: 1_048_576
  });
});

test('collection capture redacts sensitive headers', () => {
  assert.deepEqual(sanitizeHeaders({
    Authorization: 'Bearer secret',
    Cookie: 'session=secret',
    'Set-Cookie': 'session=secret',
    'X-CSRF-Token': 'secret',
    'X-Api-Key': 'secret',
    Accept: 'text/html'
  }), {
    accept: 'text/html'
  });
});

test('collection capture only stores text-like response bodies', () => {
  assert.equal(isTextCaptureContentType('text/html; charset=utf-8'), true);
  assert.equal(isTextCaptureContentType('application/json'), true);
  assert.equal(isTextCaptureContentType('application/activity+json'), true);
  assert.equal(isTextCaptureContentType('application/rss+xml'), true);
  assert.equal(isTextCaptureContentType('video/mp4'), false);
  assert.equal(isTextCaptureContentType('image/png'), false);
});
