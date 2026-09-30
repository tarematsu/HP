import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shards = readFileSync(
  new URL('../worker/src/pages-track-history-r2-shards.js', import.meta.url),
  'utf8',
);

test('full track-history publication canonicalizes only published identities', () => {
  assert.match(
    shards,
    /import \{ canonicalizeTrackRows \} from '\.\.\/\.\.\/site\/functions\/lib\/canonical-track-rows\.js';/,
  );
  assert.match(
    shards,
    /const publishedRows = db \? await canonicalizeTrackRows\(db, rows\) : rows;/,
  );
  assert.doesNotMatch(shards, /canonicalizeTrackRowsFromCatalog/);
  assert.doesNotMatch(
    shards,
    /SELECT track_id,NULL AS stationhead_track_id,[\s\S]*FROM sh_track_canonical_metadata[\s\S]*WHERE track_id IS NOT NULL/,
  );
});
