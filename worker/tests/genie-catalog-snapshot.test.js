import test from 'node:test';
import assert from 'node:assert/strict';
import { collectGenieSnapshot, GENIE_SNAPSHOT_KEY, GENIE_ARTIST_IDS, genieCheckpointKey, parseGenieCatalogPage, mergeGenieSnapshot, discoverGenieCatalog } from '../src/genie-catalog-snapshot.js';
import { enqueueGeniePublication } from '../scripts/collect-genie-r2-actions.mjs';
import { bootstrapProducerReadModel } from '../scripts/bootstrap-producer-read-model.mjs';
const now = Date.parse('2026-10-01T23:00:00Z');
const day = '2026-10-02';
const catalog = [1,2,3].map(id=>({service:'genie',canonical_artist:'sakurazaka46',service_artist_id:'80988607',service_track_id:String(id),track_url:`https://www.genie.co.kr/detail/songInfo?xgnm=${id}`,popularity_rank:id}));
const song = id=>`<a onclick="fnViewArtist('80988607')">Sakurazaka46</a><meta property="og:title" content="Song ${id} / Sakurazaka46 - genie"><b>123</b> 전체 재생수 <b>12</b> 전체 청취자수`;
const page = (ids,total)=>`총 <strong>${total}</strong><input id="hdSortType" value="pop7">`+ids.map(id=>`<a onclick="fnViewSongInfo('${id}')">song</a>`).join('');
function memory(progress) {
  const objects = new Map([[genieCheckpointKey(day),structuredClone(progress)]]);
  const writes = [];
  return { objects,writes,load:async key=>structuredClone(objects.get(key) ?? null),save:async(key,value)=>{writes.push(key);objects.set(key,structuredClone(value));} };
}
test('full catalog validates totals, repeats, popularity sort and artist identity',async()=>{
  assert.throws(()=>parseGenieCatalogPage(page([1],1).replace('pop7','newest')),/sort changed/);
  const fetchHtml = async (url,data)=>{
    const id = data ? new URLSearchParams(data).get('xxnm') : new URL(url).searchParams.get('xxnm');
    const artist = Object.entries(GENIE_ARTIST_IDS).find(([,value])=>value===id)[0];
    const label = {sakurazaka46:'Sakurazaka46',nogizaka46:'Nogizaka46',hinatazaka46:'Hinatazaka46'}[artist];
    if (url.includes('artistInfo')) return `<a onclick="fnViewArtist('${id}')">${label}</a>`;
    if (data) return page([`${id}31`],31);
    return page(Array.from({length:30},(_,i)=>`${id}${i+1}`),31);
  };
  const result = await discoverGenieCatalog(fetchHtml,now);
  assert.equal(result.catalog.length,93);
  assert.equal(result.catalog[30].popularity_rank,31);
  await assert.rejects(discoverGenieCatalog(async (url,data)=>data ? page(['809886071'],31) : fetchHtml(url,data),now),/changed during pagination/);
});
test('interruption resumes completed metrics and does no work for a complete same-day rerun',async()=>{
  const mem = memory({version:1,day,observed_at:now,artists:[],catalog,tracks:[]});
  let calls=0;
  const save = async(key,value)=>{
    await mem.save(key,value);
    if (key===genieCheckpointKey(day) && value.tracks.length===1) throw new Error('interrupted');
  };
  await assert.rejects(collectGenieSnapshot({...mem,save,now,checkpointSize:1,concurrency:1,fetchHtml:async()=>{calls++;return song(1);}}),/interrupted/);
  assert.equal(calls,1);
  const requested=[];
  const result=await collectGenieSnapshot({...mem,now,checkpointSize:1,fetchHtml:async url=>{requested.push(url);return song(2);}});
  assert.equal(requested.length,2);
  assert.equal(result.state.status,'ok');
  assert.equal(result.tracks.length,3);
  assert.equal(result.artist_track_orders[2].position,3);
  assert.equal(result.artist_track_orders[2].rank_source,'provider_popularity_order');
  await collectGenieSnapshot({...mem,now,fetchHtml:async()=>{throw new Error('must not fetch');}});
  assert.equal(mem.objects.get(GENIE_SNAPSHOT_KEY).state.status,'ok');
});
test('failed song remains stale with degraded status and retries only its missing metrics',async()=>{
  const mem=memory({version:1,day,observed_at:now,artists:[],catalog,tracks:[]});
  mem.objects.set(GENIE_SNAPSHOT_KEY,{version:1,service:'genie',updated_at:now-86400000,artists:[],artist_track_orders:[],state:{service:'genie'},tracks:[{...catalog[1],plays:999,observed_at:now-86400000,snapshot_date:'2026-10-01'}]});
  let active=0,maximum=0;
  const result=await collectGenieSnapshot({...mem,now,fetchHtml:async url=>{
    active++;maximum=Math.max(maximum,active); await Promise.resolve();active--;
    if(url.endsWith('=2')) throw new Error('HTTP 503');return song(1);
  }});
  assert.ok(maximum<=4);
  assert.equal(result.state.status,'degraded');
  assert.equal(result.state.entity_counts.failures,1);
  assert.equal(result.tracks[1].plays,999);
  assert.equal(result.tracks[1].snapshot_date,'2026-10-01');
  let retried=0;
  await collectGenieSnapshot({...mem,now,fetchHtml:async url=>{retried++;assert.ok(url.endsWith('=2'));return song(2);}});
  assert.equal(retried,1);
});
test('full R2 snapshot survives a newer legacy five-song publish and leaves other services intact',()=>{
  const source={updated_at:200,tracks:[{service:'qq_music'},{service:'genie',service_track_id:'old'}],artists:[],artist_track_orders:[],services:[{service:'genie',updated_at:200},{service:'qq_music',status:'ok'}]};
  const snapshot={version:1,service:'genie',updated_at:100,tracks:catalog,artists:[],artist_track_orders:[],state:{service:'genie',status:'degraded',updated_at:100}};
  const result=mergeGenieSnapshot(source,snapshot);
  assert.equal(result.tracks.length,4);
  assert.equal(result.services.find(row=>row.service==='genie').status,'degraded');
  assert.equal(result.services.find(row=>row.service==='qq_music').status,'ok');
  assert.equal(mergeGenieSnapshot(source,{}),source);
});
test('publication sends one shared read-model message, never one per song',async()=>{
  const calls=[];
  await enqueueGeniePublication({queues:{consumers:[{queue:'test-queue'}]}},async(path,body)=>{calls.push({path,body});return [{queue_name:'test-queue',queue_id:'test-id'}];},now);
  assert.equal(calls.length,2);
  assert.equal(calls[1].body.body.message_type,'regional-music-publish');
});
test('time budget publishes degraded coverage without losing resumable progress',async()=>{
  const mem=memory({version:1,day,observed_at:now,artists:[],catalog,tracks:[]});
  const result=await collectGenieSnapshot({...mem,now,deadline:0,fetchHtml:async()=>{throw new Error('must not fetch');}});
  assert.equal(result.state.status,'degraded');
  assert.equal(result.state.entity_counts.failures,3);
  assert.equal(mem.objects.get(genieCheckpointKey(day)).catalog.length,3);
  await assert.rejects(discoverGenieCatalog(async()=>{throw new Error('must not fetch');},now,0),/time budget exhausted/);
});
test('catalog outage publishes error health while preserving known data',async()=>{
  const mem=memory(null);
  const result=await collectGenieSnapshot({...mem,now,fetchHtml:async()=>{throw new Error('HTTP 503');}});
  assert.equal(result.state.status,'error');
  assert.equal(result.state.last_error_class,'catalog_discovery_error');
  const merged=mergeGenieSnapshot({tracks:catalog,artists:[],artist_track_orders:[],services:[]},result);
  assert.equal(merged.tracks.length,3);
  assert.equal(merged.services[0].status,'error');
});
test('deployment bootstrap merges full R2 catalog instead of republishing legacy rows',async()=>{
  let published;
  const snapshot={version:1,service:'genie',updated_at:now,tracks:catalog,artists:[],artist_track_orders:[],state:{service:'genie',status:'ok',updated_at:now}};
  await bootstrapProducerReadModel('wrangler.regional-music.jsonc',{
    now,
    config:{d1_databases:[{binding:'OTHER_DB',database_name:'test'}],r2_buckets:[{binding:'PAGES_RESPONSE_R2',bucket_name:'test'}]},
    db:{prepare:()=>({all:async()=>({results:[]})})},
    r2:{get:async key=>key===GENIE_SNAPSHOT_KEY ? {json:async()=>snapshot} : null,put:async(_key,body)=>{published=JSON.parse(JSON.parse(body).body);}},
  });
  assert.equal(published.tracks.length,3);
  assert.equal(published.services[0].storage,'r2');
});
