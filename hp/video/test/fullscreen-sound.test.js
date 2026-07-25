import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

test('player markup includes familiar playback, sound, seek, and fullscreen controls', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of ['centerPlayButton', 'playPauseButton', 'seekBar', 'muteButton', 'volumeBar', 'fullscreenButton']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /persistent-sound\.js/);
  assert.ok(html.indexOf('player-display.js') < html.indexOf('app-resilient.js'));
});

test('player display implements double tap seeking, automatic hiding, and keyboard shortcuts', async () => {
  const source = await readFile(new URL('../public/player-display.js', import.meta.url), 'utf8');
  assert.match(source, /DOUBLE_TAP_DELAY_MS/);
  assert.match(source, /CONTROL_HIDE_DELAY_MS/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /key === 'k'/);
  assert.match(source, /key === 'm'/);
  assert.match(source, /key === 'f'/);
});

test('sound preference persists volume and mute state', async () => {
  const playerSource = await readFile(new URL('../public/player-display.js', import.meta.url), 'utf8');
  const soundSource = await readFile(new URL('../public/persistent-sound.js', import.meta.url), 'utf8');
  assert.match(playerSource, /video-scraper-sound-enabled/);
  assert.match(playerSource, /video-scraper-volume/);
  assert.match(soundSource, /video-scraper-sound-enabled/);
  assert.match(soundSource, /video-scraper-volume/);
});

test('new player modules pass syntax checks', () => {
  for (const modulePath of ['public/player-display.js', 'public/persistent-sound.js', 'public/playback-gestures.js']) {
    assert.doesNotThrow(() => {
      execFileSync(process.execPath, ['--check', modulePath], {
        cwd: repositoryRoot,
        stdio: 'pipe'
      });
    }, modulePath);
  }
});
