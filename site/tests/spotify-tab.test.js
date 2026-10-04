import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const tabs = readFileSync(new URL('../public/dashboard-tabs.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');

test('Spotify stays a lazy source route', () => {
  assert.match(tabs, /spotify:\s*\{/);
  assert.match(tabs, /spotify-shell\.js\?v=/);
  assert.match(tabs, /spotify\.js\?v=/);
});

test('Spotify uses the shared music-service layout and Canvas runtime', () => {
  assert.match(shell, /mountMusicServiceView/);
  assert.match(shell, /musicServiceSection/);
  assert.match(shell, /musicServiceTable/);
  assert.match(runtime, /dashboard-chart-canvas\.js\?v=/);
  assert.match(runtime, /drawDashboardLine/);
  assert.match(runtime, /prepareDashboardCanvas/);
  assert.match(runtime, /fetch\('\/api\/spotify-playcounts'\)/);
});
