import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { onRequestGet as appleMusicApi } from '../functions/api/apple-music.js';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/apple-music.js', import.meta.url), 'utf8');
const playlists = readFileSync(new URL('../public/music-service-playlists.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../functions/api/apple-music.js', import.meta.url), 'utf8');

test('Apple Music stays lazy and uses the shared playlist runtime', () => {
  assert.match(tabs, /'apple-music':\s*\{/);
  assert.match(tabs, /apple-music-shell\.js\?v=/);
  assert.match(tabs, /apple-music\.js\?v=/);
  assert.match(runtime, /import\('\.\/music-service-playlists\.js\?v=20261005\.2'\)/);
  assert.match(runtime, /music-service-playlists\.js/);
  assert.doesNotMatch(runtime, /apple-music-playlists\.js/);
  assert.match(playlists, /endpoint: '\/api\/apple-music-playlists'/);
});

test('Apple Music reads only the materialized read model', () => {
  assert.match(api, /PAGES_READ_MODEL_SERVICE/);
  assert.match(api, /_internal\/pages-response\?key=apple-music/);
  assert.doesNotMatch(api, /OTHER_DB|MINUTE_DB|\.prepare\(/);
});

test('Apple Music returns an empty successful dataset before materialization', async () => {
  const response = await appleMusicApi({
    env: { PAGES_READ_MODEL_SERVICE: { fetch: async () => new Response(null, { status: 404 }) } },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.regions, []);
  assert.deepEqual(payload.history, []);
});
