import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../public/regional-music.js',import.meta.url),'utf8').replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g,'').replace(/export\s+/g,'');
const context = vm.createContext({});
vm.runInContext(source+';globalThis.trackRows=regionalTrackRows;',context);
test('the collaboration appears under both artists with their own list positions', () => {
  const rows = [{service:'genie',service_track_id:'song',canonical_artist:'sakurazaka46',title:'Shared song'}];
  const orders = [{service:'genie',service_track_id:'song',canonical_artist:'sakurazaka46',position:2,rank_source:'artist_page_order'}, {service:'genie',service_track_id:'song',canonical_artist:'nogizaka46',position:9,rank_source:'artist_page_order'}];
  const output = JSON.parse(JSON.stringify(context.trackRows(rows,orders)));
  assert.equal(output.length,2);
  assert.equal(output.find(item=>item.canonical_artist==='nogizaka46').popularity_rank,9);
  assert.equal(output.find(item=>item.canonical_artist==='sakurazaka46').popularity_rank,2);
  assert.equal(output[0].rank_source,'artist_page_order');
});
