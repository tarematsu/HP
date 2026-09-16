import assert from 'node:assert/strict';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const tverEpisode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);

test('TVer episode playback hides nonessential page chrome with presentation-only CSS', () => {
  assert.match(tverEpisode, /location\.hostname !== 'tver\.jp'/);
  assert.match(tverEpisode, /location\.pathname\.startsWith\('\/episodes\/'\)/);
  assert.match(tverEpisode, /const installCleanPresentation = \(\) =>/);
  assert.match(tverEpisode, /homepanel-tver-clean-player/);
  assert.match(tverEpisode, /header:not\(:has\(video\)\)/);
  assert.match(tverEpisode, /footer:not\(:has\(video\)\)/);
  assert.match(tverEpisode, /nav:not\(:has\(video\)\)/);
  assert.match(tverEpisode, /aside:not\(:has\(video\)\)/);
  assert.match(tverEpisode, /data-testid\*="recommend"/);
  assert.match(tverEpisode, /data-testid\*="related"/);
  assert.doesNotMatch(tverEpisode, /video\s*\{[\s\S]*?display\s*:\s*none/i);
  assert.doesNotMatch(tverEpisode, /\[role=["']dialog["']\]/i);
});
