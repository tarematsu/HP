import assert from 'node:assert/strict';
import test from 'node:test';

import { regionalTrackRows } from '../public/regional-music.js';

test('the collaboration appears under both artists with their own list positions', () => {
  const rows = [{ service:'qq_music', service_track_id:'song', canonical_artist:'sakurazaka46', title:'Shared song' }];
  const orders = [
    { service:'qq_music', service_track_id:'song', canonical_artist:'sakurazaka46', position:2, rank_source:'artist_page_order' },
    { service:'qq_music', service_track_id:'song', canonical_artist:'nogizaka46', position:9, rank_source:'artist_page_order' },
  ];
  const output = regionalTrackRows(rows, orders);
  assert.equal(output.length, 2);
  assert.deepEqual(output.map(item => item.canonical_artist), ['sakurazaka46', 'nogizaka46']);
  assert.equal(output.find(item => item.canonical_artist === 'nogizaka46').popularity_rank, 9);
  assert.equal(output.find(item => item.canonical_artist === 'sakurazaka46').popularity_rank, 2);
  assert.equal(output[0].rank_source, 'artist_page_order');
});
