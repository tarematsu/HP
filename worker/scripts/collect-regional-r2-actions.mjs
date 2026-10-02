import { readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { enqueueGeniePublication } from './collect-genie-r2-actions.mjs';
import { REGIONAL_MUSIC_SERVICE_COLLECTORS_BY_ID } from '../src/regional-music-entry.js';
import { REGIONAL_MUSIC_DAILY_SERVICES,regionalMusicR2DueServices } from '../src/regional-music-dispatch-plan.js';
import { collectRegionalR2Snapshot,regionalSnapshotKey,regionalDayKey,regionalSnapshotFromPayload } from '../src/regional-music-r2-snapshot.js';
import { collectGenieSnapshot } from '../src/genie-catalog-snapshot.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { regionalMusicSnapshotDate } from '../src/regional-music-store.js';
import {
  neteaseJapanHistoryRecordFromSnapshot,
  upsertNeteaseJapanHistoryArtifacts,
} from '../src/netease-japan-chart-history.js';

export async function collectRegionalR2Run({load,save,now=Date.now(),all=false,fetchImpl=fetch,collectors=REGIONAL_MUSIC_SERVICE_COLLECTORS_BY_ID}) {
  const services=all ? [...REGIONAL_MUSIC_DAILY_SERVICES] : regionalMusicR2DueServices(now);
  const results=[];
  // Small services finish before the large Genie catalog. An interrupted Genie
  // run does not discard the already persisted snapshots of other providers.
  for(const service of services.filter(value=>value!=='genie')) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),90_000);
    const fetchService=(url,options={})=>fetchImpl(url,{...options,signal:options.signal ? AbortSignal.any([options.signal,controller.signal]) : controller.signal});
    try {
      const previous=await load(regionalSnapshotKey(service));
      if(!all && previous?.day===regionalMusicSnapshotDate(now) && previous.state?.status==='ok') {
        results.push({service,status:'ok',reused:true});
        continue;
      }
      const snapshot=await collectRegionalR2Snapshot({service,collect:collectors[service],previous,now,fetchImpl:fetchService});
      await save(regionalDayKey(service,snapshot.day),snapshot);
      await save(regionalSnapshotKey(service),snapshot);
      let neteaseHistoryChanged=false;
      if(service==='netease_cloud_music' && snapshot.state?.status!=='error') {
        const record=neteaseJapanHistoryRecordFromSnapshot(snapshot,now);
        if(record) {
          const historyResult=await upsertNeteaseJapanHistoryArtifacts({load,save,record,updatedAt:now});
          neteaseHistoryChanged=historyResult.changed;
        }
      }
      results.push({service,status:snapshot.state.status,...(service==='netease_cloud_music' ? {japan_chart_history_changed:neteaseHistoryChanged} : {})});
    } finally {clearTimeout(timer);}
  }
  if(services.includes('genie')) {
    const fetchHtml=async(url,body)=>{
      const response=await fetchImpl(url,{...(body ? {method:'POST',body} : {}),headers:{accept:'text/html','accept-language':'ko-KR,ko;q=0.9,en;q=0.6','user-agent':'Mozilla/5.0 compatible; skrzk-pages-collector/1.0',...(body ? {'content-type':'application/x-www-form-urlencoded'} : {})},signal:AbortSignal.timeout(30_000)});
      if(!response.ok) throw new Error(`Genie HTTP ${response.status}`);
      return response.text();
    };
    const snapshot=await collectGenieSnapshot({load,save,now,fetchHtml});
    results.push({service:'genie',status:snapshot.state.status});
  }
  return results;
}

async function main() {
  const root=resolve(import.meta.dirname,'..');
  const config=JSON.parse(readFileSync(join(root,'wrangler.regional-music.jsonc'),'utf8'));
  const bucket=config.r2_buckets.find(row=>row.binding==='PAGES_RESPONSE_R2')?.bucket_name;
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  if(!account || !token) throw new Error('Cloudflare account context missing');
  const r2=createWranglerRemoteR2({bucket,cwd:root,wranglerScript:join(root,'node_modules/wrangler/bin/wrangler.js')});
  const published=await r2.get(pagesActionsR2ResponseKey('regional-music'));
  const envelope=published ? await published.json() : null;
  const legacy=envelope?.body ? JSON.parse(envelope.body) : null;
  const load=async key=>{
    const object=await r2.get(key);
    if(object) return object.json();
    const service=key.match(/^regional-music\/([a-z_]+)\/latest\.json$/)?.[1];
    return service && legacy ? regionalSnapshotFromPayload(legacy,service) : null;
  };
  const save=async(key,value)=>{
    await r2.put(key,JSON.stringify(value));
    console.log(JSON.stringify({event:'regional_r2_saved',key,tracks:value.tracks?.length,status:value.state?.status}));
  };
  let results;
  try {results=await collectRegionalR2Run({load,save,all:process.argv.includes('--all')});}
  finally {
    // Even an interrupted provider must publish all completed service snapshots.
    const api=async(path,body)=>{
      const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method:body ? 'POST' : 'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(30_000)});
      const result=await response.json();
      if(!response.ok || result.success!==true) throw new Error(`Publication API failed: HTTP ${response.status}`);
      return result.result;
    };
    await enqueueGeniePublication(config,api,Date.now());
  }
  console.log(JSON.stringify({event:'regional_r2_complete',results,collection_d1_writes:0,publication_messages:1}));
  if(results.some(row=>row.status==='error' || row.status==='degraded')) process.exitCode=1;
}
if(import.meta.url===pathToFileURL(process.argv[1] || '').href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
