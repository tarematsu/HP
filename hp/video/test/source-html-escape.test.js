import assert from 'node:assert/strict';
import test from 'node:test';

import { extractSourceAMediaUrls } from '../src/source-a.js';
import { addMediaCandidates } from '../src/source-b.js';
import { extractSourceEMediaUrls } from '../src/source-e.js';

const HOST = 'media.example.test';
const ESCAPED_URL = `https:&#x2f;&#x2f;${HOST}&#x2f;media&#x2f;720x1280&#x2f;sample.mp4?tag=1&amp;x=2`;
const EXPECTED_URL = `https://${HOST}/media/720x1280/sample.mp4?tag=1&x=2`;

test('active source extractors decode lowercase HTML URL escapes', () => {
  const html = `<script>{"url":"${ESCAPED_URL}"}</script>`;
  assert.deepEqual(extractSourceAMediaUrls(html, 10, HOST), [EXPECTED_URL]);
  assert.deepEqual([...addMediaCandidates(new Set(), html, HOST)], [EXPECTED_URL]);
  assert.deepEqual(extractSourceEMediaUrls(html, 10, HOST), [EXPECTED_URL]);
});
