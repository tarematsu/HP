import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  metadataValuePresent,
  normalizedIsrc,
} from '../scripts/track-metadata-consolidation-lib.mjs';

const scriptUrl = new URL('../scripts/consolidate-track-metadata.mjs', import.meta.url);

test('D1 metadata consolidation preserves the newest complete metadata row', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /'spotify_id', 'isrc', 'title'/);
  assert.match(source, /function mergeColumnSql\(column\)/);
  assert.match(source, /excluded\.fetched_at>=sh_track_metadata\.fetched_at/);
  assert.match(source, /function verifyPage\(database, sourceRows\)/);
  assert.match(source, /Target metadata \$\{column\} mismatch/);
  assert.match(source, /verified_isrc_rows/);
});

test('D1 metadata consolidation verifies by Spotify alias without changing the physical key', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /ON CONFLICT\(spotify_id\) DO UPDATE SET/);
  assert.match(source, /SELECT \$\{columns\.join\(','\)\} FROM sh_track_metadata/);
  assert.match(source, /String\(row\.spotify_id \|\| ''\)\.trim\(\)/);
});

test('metadata consolidation normalizes ISRC formatting and missing values', () => {
  assert.equal(normalizedIsrc(' jp-ab c-123 '), 'JPABC123');
  assert.equal(normalizedIsrc('JPABC123'), 'JPABC123');
  assert.equal(metadataValuePresent('  '), false);
  assert.equal(metadataValuePresent(null), false);
  assert.equal(metadataValuePresent('title'), true);
});
