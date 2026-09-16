import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const tverEpisode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const cleanPresentationStart = tverEpisode.indexOf('const installCleanPresentation = () => {');
const cleanPresentationEnd = tverEpisode.indexOf('installCleanPresentation();', cleanPresentationStart);
assert.ok(cleanPresentationStart >= 0 && cleanPresentationEnd > cleanPresentationStart);
const cleanPresentation = tverEpisode.slice(cleanPresentationStart, cleanPresentationEnd);

test('TVer episode playback hides nonessential page chrome with presentation-only CSS', () => {
  assert.match(tverEpisode, /location\.hostname !== 'tver\.jp'/);
  assert.match(tverEpisode, /location\.pathname\.startsWith\('\/episodes\/'\)/);
  assert.match(cleanPresentation, /const installCleanPresentation = \(\) =>/);
  assert.match(cleanPresentation, /homepanel-tver-clean-player/);
  assert.match(cleanPresentation, /header:not\(:has\(video\)\)/);
  assert.match(cleanPresentation, /footer:not\(:has\(video\)\)/);
  assert.match(cleanPresentation, /nav:not\(:has\(video\)\)/);
  assert.match(cleanPresentation, /aside:not\(:has\(video\)\)/);
  assert.match(cleanPresentation, /data-testid\*="recommend"/);
  assert.match(cleanPresentation, /data-testid\*="related"/);
  assert.doesNotMatch(cleanPresentation, /video\s*\{[\s\S]*?display\s*:\s*none/i);
  assert.doesNotMatch(cleanPresentation, /\[role=["']dialog["']\]/i);
});
