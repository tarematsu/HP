import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pagesEntry = readFileSync(new URL('../src/ohisama-pages-entry.js', import.meta.url), 'utf8');
const playback = readFileSync(new URL('../src/ohisama-playback.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../src/ohisama-read-model-core.js', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../../site/public/stationhead/ohisama-read-model.js', import.meta.url), 'utf8');
const cadence = readFileSync(new URL('../src/ohisama-publication-cadence.js', import.meta.url), 'utf8');

test('Ohisama keeps current/history/likes in hinata and shares Track History for playback', () => {
  assert.match(readModel, /OHISAMA_PAGES_MODEL_KEY = 'hinata'/);
  assert.match(pagesEntry, /refreshOptimizedOhisamaReadModel/);
  assert.match(pagesEntry, /mergeOhisamaPlaybackReadModelWithCadence/);
  assert.match(playback, /saveTrackHistoryDayReadModel/);
  assert.match(playback, /source: 'ohisama'/);

  for (const field of ['latest', 'history_24h', 'daily', 'queue', 'queue_status', 'likes']) {
    assert.match(`${readModel}\n${pagesEntry}\n${cadence}`, new RegExp(`\\b${field}\\b`), `missing read-model field ${field}`);
  }

  assert.match(adapter, /\/api\/track-history\?source=ohisama&dates_only=1/);
  assert.match(adapter, /source=ohisama&from=/);
  assert.doesNotMatch(adapter, /payload\?\.played_history/);
  assert.doesNotMatch(playback, /mergePlayedHistory|played_history/);
});

test('Ohisama playback history uses the shared Pages track-history path without a separate D1 reader', () => {
  assert.doesNotMatch(playback, /pagesR2ResponseKey\('hinata-(?:current|history|played-tracks|likes)'\)/);
  assert.match(playback, /pages-track-history-r2-shards\.js/);
  assert.doesNotMatch(adapter, /OHISAMA_DB|\.prepare\(/);
});
