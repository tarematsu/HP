import assert from 'node:assert/strict';
import test from 'node:test';
import { saveRegionalTrack } from '../src/regional-music-store.js';
import { regionalMusicReadModelPayload } from '../src/regional-music-read-model.js';

test('the same collaboration keeps separate artist ranks and inference sources', async () => {
  const writes = [];
  const env = { OTHER_DB: { prepare(sql) { return { bind(...values) { return { async run() { writes.push({sql,values}); } }; } }; } } };
  const base = {service:'kugou_music',service_track_id:'shared-song',observed_at:Date.UTC(2026,9,1,21),popularity_rank_source:'artist_page_order'};
  await saveRegionalTrack(env,{...base,canonical_artist:'sakurazaka46',popularity_rank:2});
  await saveRegionalTrack(env,{...base,canonical_artist:'nogizaka46',popularity_rank:9});
  const orders = writes.filter(write=>write.sql.includes('INSERT INTO regional_music_artist_track_order'));
  assert.equal(orders.length,2);
  assert.equal(orders[0].values[0],'2026-10-02');
  assert.equal(orders[0].values[2],'sakurazaka46');
  assert.equal(orders[1].values[2],'nogizaka46');
  assert.equal(orders[0].values[6],2);
  assert.equal(orders[1].values[6],9);
  assert.equal(orders[0].values[7],'artist_page_order');
});
test('a missing rank stays missing while known provider popularity order retains its source', async () => {
  const writes = [];
  const env = { OTHER_DB:{prepare(sql){return {bind(...values){return {async run(){writes.push({sql,values});}};}};}}};
  const base = {service:'qq_music',canonical_artist:'sakurazaka46',service_track_id:'song'};
  await saveRegionalTrack(env,base);
  assert.equal(writes.some(write=>write.sql.includes('artist_track_order')),false);
  await saveRegionalTrack(env,{...base,popularity_rank:1});
  assert.equal(writes.at(-1).values[7],'provider_popularity_order');
});
test('the read model exposes per-artist order and provenance', () => {
  const orders = [{service:'genie',canonical_artist:'sakurazaka46',service_track_id:'song',position:1,rank_source:'artist_page_order'}];
  assert.deepEqual(regionalMusicReadModelPayload({artistTrackOrders:orders},1).artist_track_orders,orders);
});

import { parseGenieTrackTitle } from '../src/regional-music-genie.js';
test('Genie stores its official song title instead of displaying the service ID', () => {
  assert.equal(parseGenieTrackTitle(`<meta property="og:title" content="What's &#39;KAZOKU&#39;? / Sakurazaka46 - genie">`), "What's 'KAZOKU'?");
  assert.equal(parseGenieTrackTitle(`<meta content="Title / Part Two / Nogizaka46 - genie" property="og:title">`), 'Title / Part Two');
  assert.equal(parseGenieTrackTitle('<title>genie</title>'),null);
});
