import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const followersShell = readFileSync(new URL('../public/followers-shell.js', import.meta.url), 'utf8');
const appleMusicShell = readFileSync(new URL('../public/apple-music-shell.js', import.meta.url), 'utf8');

test('leaderboard tab is immediately to the right of likes in static navigation', () => {
  const likes = html.indexOf('data-view="likes" data-mode="likes"');
  const ranking = html.indexOf('data-view="history" data-mode="ranking"');
  const broadcasts = html.indexOf('data-view="history" data-mode="broadcasts"');
  assert.ok(likes >= 0 && ranking > likes && broadcasts > ranking);
});

test('followers tab is inserted immediately after first-week comparison', () => {
  assert.match(followersShell, /anchorSelector: '\[data-view="first-week"\]'/);
  assert.match(followersShell, /position: 'afterend'/);
});

test('Apple Music tab is inserted immediately before Spotify', () => {
  assert.match(appleMusicShell, /anchorSelector: '\[data-view="spotify"\]'/);
  assert.match(appleMusicShell, /position: 'beforebegin'/);
});
