import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteR2 } from './remote-r2-json-adapter.mjs';
import { regionalSnapshotKey } from '../src/regional-music-r2-snapshot.js';

const TARGET_SERVICES=['qq_music','kugou_music'];
const TARGET_ARTISTS=new Set(['sakurazaka46','nogizaka46','hinatazaka46']);

function positiveId(value) {
  const number=Number(value);
  return Number.isSafeInteger(number) && number>0 ? number : null;
}

export function summarizeRegionalCanonicalSnapshot(service,snapshot) {
  const tracks=(snapshot?.tracks || []).filter(row=>TARGET_ARTISTS.has(String(row?.canonical_artist || '')));
  const linked=tracks.filter(row=>positiveId(row?.canonical_track_id));
  const unresolved=tracks.filter(row=>!positiveId(row?.canonical_track_id));
  const byArtist={};
  for(const artist of TARGET_ARTISTS) {
    const rows=tracks.filter(row=>row.canonical_artist===artist);
    const linkedRows=rows.filter(row=>positiveId(row.canonical_track_id));
    byArtist[artist]={total:rows.length,linked:linkedRows.length,unresolved:rows.length-linkedRows.length};
  }
  return {
    service,
    updated_at:snapshot?.updated_at ?? null,
    status:snapshot?.state?.status ?? null,
    total:tracks.length,
    linked:linked.length,
    unresolved:unresolved.length,
    linked_unique_ids:new Set(linked.map(row=>positiveId(row.canonical_track_id))).size,
    linked_percent:tracks.length ? Number((linked.length*100/tracks.length).toFixed(1)) : 0,
    by_artist:byArtist,
    unresolved_tracks:unresolved.slice(0,100).map(row=>({
      canonical_artist:row.canonical_artist,
      service_track_id:row.service_track_id,
      title:row.title,
    })),
  };
}

async function main() {
  const root=resolve(import.meta.dirname,'..');
  const config=JSON.parse(readFileSync(join(root,'wrangler.regional-music.jsonc'),'utf8'));
  const bucket=config.r2_buckets.find(row=>row.binding==='PAGES_RESPONSE_R2')?.bucket_name;
  if(!bucket) throw new Error('PAGES_RESPONSE_R2 configuration missing');
  const wranglerScript=join(root,'node_modules/wrangler/bin/wrangler.js');
  const r2=createWranglerRemoteR2({bucket,cwd:root,wranglerScript});
  const summaries=[];
  for(const service of TARGET_SERVICES) {
    const object=await r2.get(regionalSnapshotKey(service));
    if(!object) throw new Error(`Regional R2 snapshot missing: ${service}`);
    const summary=summarizeRegionalCanonicalSnapshot(service,await object.json());
    summaries.push(summary);
    console.log(JSON.stringify({event:'regional_canonical_audit',...summary}));
  }
  const stepSummary=process.env.GITHUB_STEP_SUMMARY;
  if(stepSummary) {
    const lines=['## QQ / Kugou sh_tracks.id integration audit','','| Service | Tracks | Linked | Unresolved | Linked % |','|---|---:|---:|---:|---:|'];
    for(const row of summaries) lines.push(`| ${row.service} | ${row.total} | ${row.linked} | ${row.unresolved} | ${row.linked_percent}% |`);
    lines.push('');
    for(const row of summaries) {
      lines.push(`### ${row.service}`);
      for(const [artist,value] of Object.entries(row.by_artist)) lines.push(`- ${artist}: ${value.linked}/${value.total} linked, ${value.unresolved} unresolved`);
      if(row.unresolved_tracks.length) {
        lines.push('- Unresolved sample:');
        for(const track of row.unresolved_tracks.slice(0,20)) lines.push(`  - ${track.canonical_artist}: ${track.title || '(untitled)'} [${track.service_track_id}]`);
      }
    }
    appendFileSync(stepSummary,`${lines.join('\n')}\n`,'utf8');
  }
  const empty=summaries.filter(row=>row.total>0 && row.linked===0);
  if(empty.length) throw new Error(`No sh_tracks.id links produced for: ${empty.map(row=>row.service).join(', ')}`);
}

if(import.meta.url===pathToFileURL(process.argv[1] || '').href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
