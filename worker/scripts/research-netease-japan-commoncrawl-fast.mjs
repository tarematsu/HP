import { writeFile } from 'node:fs/promises';
import { gunzipSync, inflateSync } from 'node:zlib';

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
const HEADERS={'user-agent':'Mozilla/5.0 compatible; skrzk-pages-commoncrawl-fast/1.0'};

async function response(url,init={},timeout=20000){
  const r=await fetch(url,{...init,headers:{...HEADERS,...(init.headers||{})},signal:AbortSignal.timeout(timeout)});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}
async function text(url,init={},timeout=20000){return (await response(url,init,timeout)).text();}
function loose(s){try{return JSON.parse(String(s||'').trim())}catch{return null}}
function decode(s){return String(s||'').replaceAll('&quot;','"').replaceAll('&#34;','"').replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');}
function tracks(body){
  const j=loose(body);
  for(const v of [j?.playlist?.tracks,j?.result?.tracks,j?.data?.tracks,j?.tracks])if(Array.isArray(v)&&v.length)return v;
  const m=String(body).match(/<textarea[^>]+id=["']song-list-pre-data["'][^>]*>([\s\S]*?)<\/textarea>/i);
  if(m){const v=loose(decode(m[1]));if(Array.isArray(v)&&v.length)return v;}
  return [];
}
function names(song){const a=song?.ar||song?.artists||[];return Array.isArray(a)?a.map(x=>typeof x==='string'?x:x?.name).filter(Boolean):[];}
function canonical(ns){const h=ns.join('/').normalize('NFKC').toLowerCase();for(const [id,aliases] of TARGETS)if(aliases.some(x=>h.includes(x.normalize('NFKC').toLowerCase())))return id;return null;}
function date(ts){return /^\d{14}$/.test(String(ts||''))?`${ts.slice(0,4)}-${ts.slice(4,6)}-${ts.slice(6,8)}`:null;}

const indexes=(await (await response('https://index.commoncrawl.org/collinfo.json')).json())
  .filter(x=>Number(String(x.id).match(/CC-MAIN-(\d{4})-/)?.[1]||0)>=2020);
const tasks=[];
for(const index of indexes)for(const source of SOURCES)tasks.push({index,source});
let taskCursor=0;const captures=[];const queryErrors=[];
async function queryWorker(){
  while(taskCursor<tasks.length){
    const {index,source}=tasks[taskCursor++];
    const q=new URLSearchParams({url:source,output:'json',filter:'status:200',collapse:'digest'});
    try{
      const body=await text(`${index['cdx-api']}?${q}`,{},15000);
      for(const line of body.split(/\r?\n/)){const row=loose(line);if(row)captures.push({...row,index:index.id,source_url:source});}
    }catch(e){queryErrors.push({index:index.id,source,error:String(e?.message||e)});}
  }
}
await Promise.all(Array.from({length:Math.min(24,Math.max(1,tasks.length))},()=>queryWorker()));
const unique=[...new Map(captures.map(c=>[`${c.timestamp}|${c.url}|${c.digest}|${c.filename}|${c.offset}`,c])).values()]
  .sort((a,b)=>String(a.timestamp).localeCompare(String(b.timestamp)));

function splitPayload(buffer){
  const raw=buffer.toString('latin1');
  const first=raw.indexOf('\r\n\r\n');if(first<0)return buffer;
  const second=raw.indexOf('\r\n\r\n',first+4);if(second<0)return buffer.subarray(first+4);
  const headers=raw.slice(first+4,second).toLowerCase();let body=buffer.subarray(second+4);
  if(headers.includes('content-encoding: gzip'))try{body=gunzipSync(body)}catch{}
  else if(headers.includes('content-encoding: deflate'))try{body=inflateSync(body)}catch{}
  return body;
}
async function captureBody(c){
  const offset=Number(c.offset),length=Number(c.length);
  let buf=Buffer.from(await (await response(`https://data.commoncrawl.org/${c.filename}`,{headers:{range:`bytes=${offset}-${offset+length-1}`}},25000)).arrayBuffer());
  try{buf=gunzipSync(buf)}catch{}
  return splitPayload(buf).toString('utf8');
}
let captureCursor=0;const results=[];
async function captureWorker(){
  while(captureCursor<unique.length){
    const c=unique[captureCursor++];
    try{
      const ts=tracks(await captureBody(c));const hits=[];
      ts.forEach((s,i)=>{const ns=names(s),ca=canonical(ns);if(ca)hits.push({capture_date:date(c.timestamp),timestamp:c.timestamp,canonical_artist:ca,rank:i+1,track_id:String(s?.id??''),title:s?.name??s?.title??null,artists:ns,original:c.url,index:c.index});});
      results.push({capture_date:date(c.timestamp),timestamp:c.timestamp,index:c.index,url:c.url,track_count:ts.length,hits});
    }catch(e){results.push({capture_date:date(c.timestamp),timestamp:c.timestamp,index:c.index,url:c.url,track_count:0,error:String(e?.message||e),hits:[]});}
  }
}
await Promise.all(Array.from({length:Math.min(12,Math.max(1,unique.length))},()=>captureWorker()));
const hits=results.flatMap(x=>x.hits).sort((a,b)=>String(a.capture_date).localeCompare(String(b.capture_date))||a.rank-b.rank);
const summary=Object.fromEntries(TARGETS.map(([id])=>{const r=hits.filter(x=>x.canonical_artist===id);return [id,{count:r.length,earliest:r[0]?.capture_date??null,latest:r.at(-1)?.capture_date??null,best_rank:r.length?Math.min(...r.map(x=>x.rank)):null,tracks:[...new Set(r.map(x=>x.title).filter(Boolean))]}];}));
const report={generated_at:new Date().toISOString(),chart_id:CHART_ID,index_count:indexes.length,query_count:tasks.length,query_errors:queryErrors.length,capture_count:unique.length,parsed_snapshot_count:results.filter(x=>x.track_count>0).length,query_error_examples:queryErrors.slice(0,20),captures:unique,results,hits,summary};
await writeFile('netease-japan-commoncrawl-fast.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({index_count:report.index_count,query_count:report.query_count,query_errors:report.query_errors,capture_count:report.capture_count,parsed_snapshot_count:report.parsed_snapshot_count,hits:hits.length,summary,query_error_examples:report.query_error_examples.slice(0,5)},null,2));
