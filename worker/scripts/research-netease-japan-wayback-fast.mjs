import { writeFile } from 'node:fs/promises';

const CHART_ID='5059644681';
const SOURCES=[
  `https://music.163.com/playlist?id=${CHART_ID}`,
  `https://music.163.com/discover/toplist?id=${CHART_ID}`,
  `https://music.163.com/api/v6/playlist/detail?id=${CHART_ID}`,
  `https://music.163.com/api/playlist/detail?id=${CHART_ID}`,
];
const TARGETS=[
  ['sakurazaka46',['櫻坂46','樱坂46','Sakurazaka46']],
  ['nogizaka46',['乃木坂46','Nogizaka46']],
  ['hinatazaka46',['日向坂46','Hinatazaka46']],
];
const headers={'user-agent':'Mozilla/5.0 compatible; skrzk-pages-wayback-fast/1.0'};

async function get(url, timeout=15000){
  const r=await fetch(url,{headers,signal:AbortSignal.timeout(timeout)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
function decode(s){return String(s||'').replaceAll('&quot;','"').replaceAll('&#34;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');}
function loose(s){try{return JSON.parse(String(s||'').trim())}catch{return null}}
function tracks(body){
  const j=loose(body);
  for(const v of [j?.playlist?.tracks,j?.result?.tracks,j?.data?.tracks,j?.tracks]) if(Array.isArray(v)&&v.length)return v;
  const m=String(body).match(/<textarea[^>]+id=["']song-list-pre-data["'][^>]*>([\s\S]*?)<\/textarea>/i);
  if(m){const v=loose(decode(m[1]));if(Array.isArray(v)&&v.length)return v;}
  return [];
}
function names(song){const a=song?.ar||song?.artists||[];return Array.isArray(a)?a.map(x=>typeof x==='string'?x:x?.name).filter(Boolean):[];}
function canonical(ns){const h=ns.join('/').normalize('NFKC').toLowerCase();for(const [id,aliases] of TARGETS)if(aliases.some(x=>h.includes(x.normalize('NFKC').toLowerCase())))return id;return null;}
function cdx(source){const q=new URLSearchParams({url:source,output:'json',fl:'timestamp,original,statuscode,mimetype,digest',filter:'statuscode:200',collapse:'digest',from:'2020',to:String(new Date().getUTCFullYear()),limit:'1000'});return `https://web.archive.org/cdx/search/cdx?${q}`;}

const captureLists=await Promise.all(SOURCES.map(async source=>{
  try{
    const data=loose(await get(cdx(source),20000));
    if(!Array.isArray(data)||data.length<2)return {source,captures:[],error:null};
    const [head,...rows]=data;
    return {source,captures:rows.map(row=>Object.fromEntries(head.map((k,i)=>[k,row[i]]))),error:null};
  }catch(e){return {source,captures:[],error:String(e?.message||e)}}
}));
const caps=[...new Map(
  captureLists.flatMap(x=>x.captures.map(c=>[`${c.timestamp}|${c.original}|${c.digest}`,c]))
).values()];
let cursor=0;const results=[];
async function worker(){while(cursor<caps.length){const c=caps[cursor++];const url=`https://web.archive.org/web/${c.timestamp}id_/${c.original}`;try{const ts=tracks(await get(url,20000));const hits=[];ts.forEach((s,i)=>{const ns=names(s);const ca=canonical(ns);if(ca)hits.push({capture_date:`${c.timestamp.slice(0,4)}-${c.timestamp.slice(4,6)}-${c.timestamp.slice(6,8)}`,timestamp:c.timestamp,canonical_artist:ca,rank:i+1,track_id:String(s?.id??''),title:s?.name??s?.title??null,artists:ns,original:c.original});});results.push({timestamp:c.timestamp,original:c.original,track_count:ts.length,hits});}catch(e){results.push({timestamp:c.timestamp,original:c.original,track_count:0,error:String(e?.message||e),hits:[]});}}}
await Promise.all(Array.from({length:Math.min(8,Math.max(1,caps.length))},()=>worker()));
const hits=results.flatMap(x=>x.hits).sort((a,b)=>a.capture_date.localeCompare(b.capture_date)||a.rank-b.rank);
const summary=Object.fromEntries(TARGETS.map(([id])=>{const r=hits.filter(x=>x.canonical_artist===id);return [id,{count:r.length,earliest:r[0]?.capture_date??null,latest:r.at(-1)?.capture_date??null,best_rank:r.length?Math.min(...r.map(x=>x.rank)):null,tracks:[...new Set(r.map(x=>x.title).filter(Boolean))]}];}));
const report={generated_at:new Date().toISOString(),chart_id:CHART_ID,capture_sources:captureLists.map(x=>({source:x.source,count:x.captures.length,error:x.error})),capture_count:caps.length,parsed_snapshot_count:results.filter(x=>x.track_count>0).length,results,hits,summary};
await writeFile('netease-japan-wayback-fast.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({capture_sources:report.capture_sources,capture_count:report.capture_count,parsed_snapshot_count:report.parsed_snapshot_count,hits:hits.length,summary},null,2));
