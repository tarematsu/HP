import assert from 'node:assert/strict';
import test from 'node:test';

import { videoSessionKey } from '../public/playback-gestures.js';

test('different media query strings remain distinct', () => {
  assert.notEqual(
    videoSessionKey('https://cdn.example/video.mp4?id=1'),
    videoSessionKey('https://cdn.example/video.mp4?id=2')
  );
});

test('URL fragments do not create different media resources', () => {
  assert.equal(
    videoSessionKey('https://cdn.example/video.mp4?id=1#start'),
    videoSessionKey('https://cdn.example/video.mp4?id=1#other')
  );
});

test('default HTTPS port and hostname case normalize consistently', () => {
  assert.equal(
    videoSessionKey('https://CDN.EXAMPLE:443/video.mp4?id=1'),
    videoSessionKey('https://cdn.example/video.mp4?id=1')
  );
});

test('protocol and non-default port remain part of the resource identity', () => {
  assert.notEqual(
    videoSessionKey('http://cdn.example/video.mp4?id=1'),
    videoSessionKey('https://cdn.example/video.mp4?id=1')
  );
  assert.notEqual(
    videoSessionKey('https://cdn.example:8443/video.mp4?id=1'),
    videoSessionKey('https://cdn.example/video.mp4?id=1')
  );
});

test('invalid URL values retain a stable fallback', () => {
  assert.equal(videoSessionKey('not a URL'), 'not a URL');
  assert.equal(videoSessionKey(null), '');
});
