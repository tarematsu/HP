import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const pagesEntry = readFileSync(new URL('../src/ohisama-pages-entry.js', import.meta.url), 'utf8');
const playback = readFileSync(new URL('../src/ohisama-playback.js', import.meta.url), 'utf8');
const publication = readFileSync(new URL('../src/stationhead-playback-publication.js', import.meta.url), 'utf8');
const readModel = readFileSync(new URL('../src/ohisama-read-model.js', import.meta.url), 'utf8');
const sharedReadModel = readFileSync(new URL('../../packages/sh-shared/stationhead-read-models.mjs', import.meta.url), 'utf8');
const sourceProfile = readFileSync(new URL('../../packages/sh-shared/stationhead-source.mjs', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../../site/public/stationhead/ohisama-read-model.js', import.meta.url), 'utf8');
const sharedSourceModel = readFileSync(new URL('../../site/public/stationhead/source-model.js', import.meta.url), 'utf8');
const trackHistoryClient = readFileSync(new URL('../../site/public/stationhead/track-history-client.js', import.meta.url), 'utf8');
const cadence = readFileSync(new URL('../src/ohisama-publication-cadence.js', import.meta.url), 'utf8');

test('Ohisama keeps current/history in hinata and shares Track History for playback and likes', () => {
  assert.match(readModel, /OHISAMA_PAGES_MODEL_KEY = OHISAMA_PROFILE\.modelKey/);
  assert.match(sourceProfile, /modelKey: 'hinata'/);
  assert.match(pagesEntry, /refreshOhisamaReadModel/);
  assert.match(pagesEntry, /mergeOhisamaPlaybackReadModelWithCadence/);
  assert.match(publication, /saveTrackHistoryDayReadModel/);
  assert.match(playback, /publishStationheadPlaybackDay\(bucket, 'ohisama'/);

  for (const field of ['latest', 'history_24h', 'daily', 'queue', 'queue_status']) {
    assert.match(`${readModel}\n${sharedReadModel}\n${sourceProfile}\n${pagesEntry}\n${cadence}`, new RegExp(`\\b${field}\\b`), `missing read-model field ${field}`);
  }
  assert.match(cadence, /delete next\.likes;/);
  assert.doesNotMatch(cadence, /next\.likes\s*=|preserved\(previousPayload, 'likes'/);

  assert.ok(adapter.includes("artistFilter: '日向坂46'"));
  assert.ok(sharedSourceModel.includes('createStationheadTrackHistoryClient(source, artistFilter, fetchJson)'));
  assert.match(trackHistoryClient, /source=\$\{encodeURIComponent\(source\)\}&/);
  assert.match(trackHistoryClient, /endpoint\('dates_only=1'\)/);
  assert.match(trackHistoryClient, /endpoint\(`from=/);
  assert.match(trackHistoryClient, /endpoint\('ranking_only=1&ranking_limit=500'\)/);
  assert.doesNotMatch(adapter, /payload\?\.played_history|payload\.likes/);
  assert.doesNotMatch(playback, /mergePlayedHistory|played_history/);
});

test('Ohisama playback history uses the shared Pages track-history path without a separate D1 reader', () => {
  assert.doesNotMatch(playback, /pagesR2ResponseKey\('hinata-(?:current|history|played-tracks|likes)'\)/);
  assert.match(publication, /pages-track-history-r2-shards\.js/);
  assert.doesNotMatch(adapter, /OHISAMA_DB|\.prepare\(/);
});
