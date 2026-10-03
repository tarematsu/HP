import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync(new URL('../src/ohisama-runtime-metadata.js', import.meta.url), 'utf8');
const entry = readFileSync(new URL('../src/ohisama-pages-entry.js', import.meta.url), 'utf8');

test('Ohisama runtime metadata enrichment uses the central minute database', () => {
  assert.match(runtime, /const db = env\?\.MINUTE_DB/);
  assert.match(runtime, /environmentView\(env, \{ DB: db \}\)/);
  assert.match(runtime, /enrichTracks/);
  assert.match(runtime, /metadataRepairLimit: 0/);
});

test('Ohisama runtime enrichment is bounded to the visible playback queue', () => {
  assert.match(runtime, /resolveOhisamaPlaybackWindow/);
  assert.match(runtime, /const MAX_METADATA_LIMIT = 6/);
  assert.match(runtime, /const DEFAULT_METADATA_LIMIT = 2/);
  assert.match(runtime, /OHISAMA_METADATA_LIMIT/);
});

test('Ohisama resolves presentation metadata before playback capture', () => {
  const enrichment = entry.indexOf('metadataEnrichment = await enrichPlaybackMetadata(');
  const capture = entry.indexOf('playback = await captureOhisamaPlayback(');
  assert.ok(enrichment >= 0, 'metadata enrichment hook is missing');
  assert.ok(capture >= 0, 'playback capture hook is missing');
  assert.ok(enrichment < capture, 'metadata must be committed before canonical playback hydration');
  assert.match(entry, /ohisama_playback_metadata_enriched/);
  assert.match(entry, /ohisama_playback_metadata_enrichment_failed/);
});
