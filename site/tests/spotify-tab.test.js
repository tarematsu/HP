import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { ROUTES } from '../public/dashboard-navigation-config.js';

const shell = readFileSync(new URL('../public/spotify-shell.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../public/spotify.js', import.meta.url), 'utf8');

test('Spotify stays a lazy source route', () => {
  const route = ROUTES.spotify;
  assert.equal(route.kind, 'lazy');
  assert.equal(route.viewId, 'spotifyView');
  assert.equal(route.moduleId, 'spotify');
  assert.equal(route.loadExport, 'loadSpotifyView');
});

test('Spotify uses the shared music-service layout and Canvas runtime', () => {
  assert.match(shell, /mountMusicServiceView/);
  assert.match(shell, /musicServiceSection/);
  assert.match(shell, /musicServiceTable/);
  const canvas = readFileSync(new URL('../public/spotify-trend-chart.js', import.meta.url), 'utf8');
  assert.match(canvas, /dashboard-chart-canvas\.js\?v=/);
  assert.match(canvas, /drawDashboardLine/);
  assert.match(canvas, /prepareDashboardCanvas/);
  assert.match(runtime, /loadSpotifyReadModel/);
});
