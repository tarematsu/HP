import { readFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { REGIONAL_MUSIC_SERVICE_COLLECTORS_BY_ID } from '../src/regional-music-entry.js';
import { REGIONAL_MUSIC_DAILY_SERVICES,regionalMusicR2DueServices } from '../src/regional-music-dispatch-plan.js';
import { collectRegionalR2Snapshot,regionalSnapshotKey,regionalDayKey,regionalSnapshotFromPayload } from '../src/regional-music-r2-snapshot.js';
import { pagesActionsR2ResponseKey } from '../src/pages-response-r2.js';
import { regionalMusicSnapshotDate } from '../src/regional-music-store.js';
import {
  kkboxHistoryRecordsFromSnapshot,
  upsertKkboxJapaneseHistoryArtifacts,
} from '../src/kkbox-japanese-chart-history.js';

const REGIONAL_SERVICE_SET=new Set(REGIONAL_MUSIC_DAILY_SERVICES);

async function enqueueRegionalPublication(config, api, now) {
  const name=config.queues?.consumers?.[0]?.queue;
  if(!name) throw new Error('Regional publication queue missing');
  const queues=await api('/queues');
  const queue=queues.find(row=>row.queue_name===name);
  if(!queue?.queue_id) throw new Error('Regional publication queue not found');
  await api(`/queues/${queue.queue_id}/messages`,{body:{message_type:'regional-music-publish',scheduled_at:now},content_type:'json'});
}

export function parseRegionalServiceSelection(argv=process.argv.slice(2)) {
  const argument=(argv || []).find(value=>String(value).startsWith('--services='));
  if(!argument) return [];
  const services=[...new Set(String(argument).slice('--services='.length).split(',').map(value=>value.trim()).filter(Boolean))];
  const invalid=services.filter(service=>!REGIONAL_SERVICE_SET.has(service));
  if(invalid.length) throw new Error(`Unknown regional services: ${invalid.join(', ')}`);
  return services;
}

export async function collectRegionalR2Run({load,save,now=Date.now(),all=false,services:requestedServices=[],fetchImpl=fetch,collectors=REGIONAL_MUSIC_SERVICE_COLLECTORS_BY_ID,bindings={}}) {
  const explicit=[...new Set((requestedServices || []).map(value=>String(value).trim()).filter(Boolean))];
  const invalid=explicit.filter(service=>!REGIONAL_SERVICE_SET.has(service));
  if(invalid.length) throw new Error(`Unknown regional services: ${invalid.join(', ')}`);
  const services=explicit.length ? explicit : all ? [...REGIONAL_MUSIC_DAILY_SERVICES] : regionalMusicR2DueServices(now);
  const force=all || explicit.length>0;
  const results=[];
  for(const service of services) {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),90_000);
    const fetchService=(url,options={})=>fetchImpl(url,{...options,signal:options.signal ? AbortSignal.any([options.signal,controller.signal]) : controller.signal});
    try {
      const previous=await load(regionalSnapshotKey(service));
      if(!force && previous?.day===regionalMusicSnapshotDate(now) && previous.state?.status==='ok') {
        results.push({service,status:'ok',reused:true});
        continue;
      }
      const collect=collectors[service];
      if(typeof collect!=='function') throw new Error(`Regional collector missing: ${service}`);
      const snapshot=await collectRegionalR2Snapshot({service,collect,previous,now,fetchImpl:fetchService,bindings});
      await save(regionalDayKey(service,snapshot.day),snapshot);
      await save(regionalSnapshotKey(service),snapshot);
      let kkboxHistoryChanged=false;
      if(service==='kkbox' && snapshot.state?.status!=='error') {
        const records=kkboxHistoryRecordsFromSnapshot(snapshot);
        if(records.length) {
          const historyResult=await upsertKkboxJapaneseHistoryArtifacts({load,save,records,updatedAt:now});
          kkboxHistoryChanged=historyResult.changed;
        }
      }
      results.push({
        service,
        status:snapshot.state.status,
        ...(service==='kkbox' ? {japanese_chart_history_changed:kkboxHistoryChanged} : {}),
      });
    } finally {clearTimeout(timer);}
  }
  return results;
}

async function main() {
  const root=resolve(import.meta.dirname,'..');
  const config=JSON.parse(readFileSync(join(root,'wrangler.regional-music.jsonc'),'utf8'));
  const bucket=config.r2_buckets.find(row=>row.binding==='PAGES_RESPONSE_R2')?.bucket_name;
  const minuteDatabase=config.d1_databases.find(row=>row.binding==='MINUTE_DB')?.database_name;
  const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  if(!account || !token) throw new Error('Cloudflare account context missing');
  if(!minuteDatabase) throw new Error('MINUTE_DB configuration missing');
  const wranglerScript=join(root,'node_modules/wrangler/bin/wrangler.js');
  const r2=createWranglerRemoteR2({bucket,cwd:root,wranglerScript});
  const minuteDb=createWranglerRemoteD1({database:minuteDatabase,cwd:root,wranglerScript});
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
  const requestedServices=parseRegionalServiceSelection();
  let results;
  try {results=await collectRegionalR2Run({load,save,all:process.argv.includes('--all'),services:requestedServices,bindings:{MINUTE_DB:minuteDb}});}
  finally {
    // Even an interrupted provider must publish all completed service snapshots.
    const api=async(path,body)=>{
      const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method:body ? 'POST' : 'GET',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},...(body ? {body:JSON.stringify(body)} : {}),signal:AbortSignal.timeout(30_000)});
      const result=await response.json();
      if(!response.ok || result.success!==true) throw new Error(`Publication API failed: HTTP ${response.status}`);
      return result.result;
    };
    await enqueueRegionalPublication(config,api,Date.now());
  }
  console.log(JSON.stringify({event:'regional_r2_complete',results,requested_services:requestedServices,collection_d1_writes:0,canonical_d1_reads:true,publication_messages:1}));
  if(results.some(row=>row.status==='error' || row.status==='degraded')) process.exitCode=1;
}
if(import.meta.url===pathToFileURL(process.argv[1] || '').href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
