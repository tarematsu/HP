import { appendFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWranglerRemoteD1 } from './remote-d1-adapter.mjs';
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

async function exactTitleCandidates(db,titles) {
  const result=new Map();
  const unique=[...new Set(titles.filter(Boolean))];
  for(let offset=0;offset<unique.length;offset+=40) {
    const part=unique.slice(offset,offset+40);
    const placeholders=part.map(()=>'?').join(',');
    const query=await db.prepare(`SELECT id,title,artist,isrc,spotify_id FROM sh_tracks WHERE title IN (${placeholders}) ORDER BY title,id`).bind(...part).all();
    for(const row of query.results || []) {
      const rows=result.get(row.title) || [];
      rows.push(row);
      result.set(row.title,rows);
    }
  }
  return result;
}

async function main() {
  const root=resolve(import.meta.dirname,'..');
  const config=JSON.parse(readFileSync(join(root,'wrangler.regional-music.jsonc'),'utf8'));
  const bucket=config.r2_buckets.find(row=>row.binding==='PAGES_RESPONSE_R2')?.bucket_name;
  const minuteDatabase=config.d1_databases.find(row=>row.binding==='MINUTE_DB')?.database_name;
  if(!bucket) throw new Error('PAGES_RESPONSE_R2 configuration missing');
  if(!minuteDatabase) throw new Error('MINUTE_DB configuration missing');
  const wranglerScript=join(root,'node_modules/wrangler/bin/wrangler.js');
  const r2=createWranglerRemoteR2({bucket,cwd:root,wranglerScript});
  const minuteDb=createWranglerRemoteD1({database:minuteDatabase,cwd:root,wranglerScript});
  const summaries=[];
  for(const service of TARGET_SERVICES) {
    const object=await r2.get(regionalSnapshotKey(service));
    if(!object) throw new Error(`Regional R2 snapshot missing: ${service}`);
    const summary=summarizeRegionalCanonicalSnapshot(service,await object.json());
    summaries.push(summary);
    console.log(JSON.stringify({event:'regional_canonical_audit',...summary}));
  }
  const unresolved=summaries.flatMap(summary=>summary.unresolved_tracks.map(track=>({...track,service:summary.service})));
  const exact=await exactTitleCandidates(minuteDb,unresolved.map(row=>row.title));
  for(const row of unresolved) {
    const candidates=(exact.get(row.title) || []).map(candidate=>({id:candidate.id,title:candidate.title,artist:candidate.artist,isrc:candidate.isrc,spotify_id:candidate.spotify_id}));
    console.log(JSON.stringify({event:'regional_canonical_unresolved_diagnostic',...row,exact_title_candidates:candidates}));
  }
  const stepSummary=process.env.GITHUB_STEP_SUMMARY;
  if(stepSummary) {
    const lines=['## QQ / Kugou sh_tracks.id integration audit','','| Service | Tracks | Linked | Unresolved | Linked % |','|---|---:|---:|---:|---:|'];
    for(const row of summaries) lines.push(`| ${row.service} | ${row.total} | ${row.linked} | ${row.unresolved} | ${row.linked_percent}% |`);
    const exactCandidateCount=unresolved.filter(row=>(exact.get(row.title) || []).length).length;
    lines.push('',`Exact-title sh_tracks candidates found for ${exactCandidateCount}/${unresolved.length} unresolved provider rows.`);
    for(const row of summaries) {
      lines.push('',`### ${row.service}`);
      for(const [artist,value] of Object.entries(row.by_artist)) lines.push(`- ${artist}: ${value.linked}/${value.total} linked, ${value.unresolved} unresolved`);
    }
    appendFileSync(stepSummary,`${lines.join('\n')}\n`,'utf8');
  }
  const empty=summaries.filter(row=>row.total>0 && row.linked===0);
  if(empty.length) throw new Error(`No sh_tracks.id links produced for: ${empty.map(row=>row.service).join(', ')}`);
}

if(import.meta.url===pathToFileURL(process.argv[1] || '').href) main().catch(error=>{console.error(error.message);process.exitCode=1;});
