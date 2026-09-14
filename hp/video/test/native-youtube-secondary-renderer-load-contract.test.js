import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const youtubePolicy = readFileSync(
  new URL('../../native/src/renderer_panels/media_youtube_policy.inc', import.meta.url),
  'utf8',
);

test('YouTube native media panel removes unused watch-page shell from layout and paint', () => {
  for (const selector of [
    'ytd-watch-flexy #secondary',
    'ytd-watch-flexy #below',
    'ytd-watch-flexy #chat-container',
    'ytd-watch-flexy #related',
    'ytd-watch-flexy ytd-comments',
    'ytd-masthead',
    'ytd-mini-guide-renderer',
    'ytd-guide-renderer',
  ]) {
    assert.match(youtubePolicy, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(youtubePolicy, /display: none !important/);
  assert.match(youtubePolicy, /visibility: hidden !important/);
  assert.match(youtubePolicy, /pointer-events: none !important/);
});

test('YouTube load reduction keeps player media and trusted controls intact', () => {
  assert.doesNotMatch(youtubePolicy, /#movie_player\s*\{[^}]*display:\s*none/s);
  assert.match(youtubePolicy, /\.html5-video-container/);
  assert.match(youtubePolicy, /\.ytp-fullscreen-button|ytp-chrome-bottom/);
  assert.match(youtubePolicy, /\.ytp-ad-skip-button-modern/);
  assert.match(youtubePolicy, /opacity: 1 !important/);
});
