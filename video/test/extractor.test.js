import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalVideoKey,
  extractVideoUrls,
  normalizeMediaHost,
  normalizeVideoUrl
} from '../src/extractor.js';

const HOST = 'media.example.test';

test('extracts direct and escaped media URLs in source order', () => {
  const html = `
    <video src="https://${HOST}/media/1/720x1280/a.mp4?tag=12&amp;x=1"></video>
    <script>{"url":"https:\\/\\/${HOST}\\/media\\/2\\/b.mp4?tag=14"}</script>
  `;
  assert.deepEqual(extractVideoUrls(html, 100, HOST), [
    `https://${HOST}/media/1/720x1280/a.mp4?tag=12&x=1`,
    `https://${HOST}/media/2/b.mp4?tag=14`
  ]);
});

test('rejects lookalike hosts and unsupported protocols while upgrading HTTP', () => {
  assert.equal(normalizeVideoUrl(`https://${HOST}.evil.example/a.mp4`, HOST), null);
  assert.equal(normalizeVideoUrl(`ftp://${HOST}/a.mp4`, HOST), null);
  assert.equal(
    normalizeVideoUrl(`http://${HOST}/a.mp4?tag=12`, HOST),
    `https://${HOST}/a.mp4?tag=12`
  );
});

test('canonical key ignores transient query parameters', () => {
  const a = canonicalVideoKey(`https://${HOST}/a.mp4?tag=12&token=one`, HOST);
  const b = canonicalVideoKey(`https://${HOST}/a.mp4?tag=14&token=two`, HOST);
  assert.equal(a, b);
});

test('deduplicates repeated paths even when query parameters differ', () => {
  const input = [
    `https://${HOST}/a.mp4?tag=12`,
    `http://${HOST}/a.mp4?tag=14`,
    `https://${HOST}/b.mp4`
  ].join(' ');
  assert.deepEqual(extractVideoUrls(input, 100, HOST), [
    `https://${HOST}/a.mp4?tag=12`,
    `https://${HOST}/b.mp4`
  ]);
});

test('validates media host values', () => {
  assert.equal(normalizeMediaHost('MEDIA.EXAMPLE.TEST'), HOST);
  assert.throws(() => normalizeMediaHost('https://media.example.test/path'));
});
