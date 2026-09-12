import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { readExpandedNativeSource } from './helpers/read-expanded-native-source.js';

const episode = readExpandedNativeSource(
  '../../native/src/renderer_panels/media_tver_episode_loop_policy.inc', import.meta.url);
const refresh = readFileSync(
  new URL('../../native/src/renderer_panels/media_tver_cloud_queue_refresh.inc', import.meta.url), 'utf8');

test('TVer playback does not special-case a series page or recommended episode', () => {
  assert.match(episode, /episodeQueueKey = '__homePanelTverEpisodeQueue'/);
  assert.doesNotMatch(episode, /__homePanelTverEpisodeQueue:/);
  assert.match(episode, /location\.replace\(queue\.hrefs\[nextIndex\]\)/);
  assert.doesNotMatch(episode, /deathGameSeriesPath|findSeriesEpisodeContainer|おすすめ/);
  assert.match(refresh, /for \(const href of freshEpisodes\)/);
  assert.match(refresh, /if \(!href \|\| seen\.has\(href\)\) continue/);
});
