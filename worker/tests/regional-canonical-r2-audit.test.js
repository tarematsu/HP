import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRegionalCanonicalSnapshot } from '../scripts/audit-regional-canonical-r2.mjs';

test('canonical R2 audit counts only Sakamichi tracks and reports unresolved rows',()=>{
  const summary=summarizeRegionalCanonicalSnapshot('qq_music',{
    updated_at:123,
    state:{status:'ok'},
    tracks:[
      {canonical_artist:'sakurazaka46',service_track_id:'1',title:'承认欲求',canonical_track_id:77},
      {canonical_artist:'sakurazaka46',service_track_id:'2',title:'未解決'},
      {canonical_artist:'nogizaka46',service_track_id:'3',title:'17分間',canonical_track_id:'88'},
      {canonical_artist:null,service_track_id:'4',title:'Other',canonical_track_id:99},
    ],
  });
  assert.equal(summary.total,3);
  assert.equal(summary.linked,2);
  assert.equal(summary.unresolved,1);
  assert.equal(summary.linked_unique_ids,2);
  assert.equal(summary.linked_percent,66.7);
  assert.equal(summary.by_artist.sakurazaka46.unresolved,1);
  assert.deepEqual(summary.unresolved_tracks.map(row=>row.service_track_id),['2']);
});
