import fs from 'node:fs';

const RANK_ID = 31312;
const RANK_CID = 48141;
const PAGES = [1, 2, 3, 4];
const CONCURRENCY = 8;
const RETRIES = 1;

const aliases = {
  sakurazaka46: ['櫻坂46','桜坂46','Sakurazaka46','樱坂46'],
  hinatazaka46: ['日向坂46','Hinatazaka46'],
  nogizaka46: ['乃木坂46','Nogizaka46'],
};
const headers = {
  'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  accept:'text/html,application/xhtml+xml',
};
const normalize = (value) => String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/g, '');
function groupFor(entry) {
  const haystack = normalize([entry?.singername, entry?.author_name, entry?.filename, entry?.songname].filter(Boolean).join(' '));
  for (const [group,names] of Object.entries(aliases)) if (names.some(name => haystack.includes(normalize(name)))) return group;
  return null;
}
function extractJsonArrayAfter(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = text.indexOf('[', markerIndex + marker.length);
  if (start < 0) return null;
  let depth=0,inString=false,escaped=false;
  for (let i=start;i<text.length;i+=1) {
    const ch=text[i];
    if (inString) {
      if (escaped) escaped=false;
      else if (ch==='\\') escaped=true;
      else if (ch==='"') inString=false;
      continue;
    }
    if (ch==='"') { inString=true; continue; }
    if (ch==='[') depth+=1;
    else if (ch===']' && --depth===0) return text.slice(start,i+1);
  }
  return null;
}
function parseFeatures(text) {
  const raw=extractJsonArrayAfter(text,'global.features');
  if (!raw) throw new Error('global.features not found');
  return JSON.parse(raw);
}
function singerFor(entry) {
  const singer=String(entry?.singername || '').trim();
  if (singer) return singer;
  const filename=String(entry?.filename || '').trim();
  const split=filename.indexOf(' - ');
  return split>=0 ? filename.slice(0,split) : '';
}
function titleFor(entry) {
  const song=String(entry?.songname || '').trim();
  if (song) return song;
  const filename=String(entry?.filename || '').trim();
  const singer=singerFor(entry);
  return singer && filename.startsWith(`${singer} - `) ? filename.slice(singer.length+3) : filename;
}
async function fetchWithRetry(url, options={}, retries=RETRIES) {
  let last;
  for (let attempt=0;attempt<=retries;attempt+=1) {
    try {
      const response=await fetch(url,{...options,signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      last=error;
      if (attempt<retries) await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
    }
  }
  throw last;
}
async function fetchVolumes() {
  const url=`http://mobilecdnbj.kugou.com/api/v3/rank/vol?rankid=${RANK_ID}&plat=0&version=9108&ranktype=1&rank_cid=${RANK_CID}`;
  const response=await fetchWithRetry(url,{redirect:'follow',headers:{'user-agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Mobile Safari/537.36',accept:'application/json,*/*'}});
  const json=await response.json();
  if (json?.status!==1 || Number(json?.errcode || 0)!==0) throw new Error(`rank/vol failure: ${JSON.stringify(json).slice(0,500)}`);
  const years=Array.isArray(json?.data?.info) ? json.data.info : [];
  return years
    .filter(row => Number(row?.year) <= 2020)
    .flatMap(row => (Array.isArray(row?.vols) ? row.vols : []).map(vol => ({
      year:Number(row.year),
      volid:Number(vol.volid),
      issue:Number(String(vol.volname || '').match(/\d+/)?.[0] || 0) || null,
      expected_date:String(vol.voltime || vol.outer_text || '').slice(0,10),
      voltime:vol.voltime || null,
    })))
    .filter(row => Number.isFinite(row.volid))
    .sort((a,b)=>a.volid-b.volid);
}
async function fetchPage(vol,page) {
  const url=`https://pc.service.kugou.com/yueku/v8/rank/home/${page}-${RANK_ID}-${vol.volid}.html`;
  const response=await fetchWithRetry(url,{redirect:'follow',headers});
  const text=await response.text();
  const date=text.match(/(20\d{2})[-\/.年](\d{1,2})[-\/.月](\d{1,2})/)?.[0]?.replace(/[年/.]/g,'-').replace('月','-').replace('日','') || null;
  return { page,date,entries:parseFeatures(text),url };
}
async function mapLimit(items,limit,fn) {
  const results=new Array(items.length); let cursor=0;
  async function worker() {
    while (true) {
      const index=cursor++;
      if (index>=items.length) return;
      try { results[index]={ok:true,value:await fn(items[index])}; }
      catch (error) { results[index]={ok:false,item:items[index],error:String(error?.stack || error)}; }
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  return results;
}
const csvEscape=(value)=>value==null?'':/[",\n]/.test(String(value))?`"${String(value).replaceAll('"','""')}"`:String(value);

const observedAt=new Date().toISOString();
const volumes=await fetchVolumes();
const tasks=volumes.flatMap(vol=>PAGES.map(page=>({vol,page})));
const fetched=await mapLimit(tasks,CONCURRENCY,({vol,page})=>fetchPage(vol,page).then(result=>({vol,...result})));
const successes=fetched.filter(row=>row.ok).map(row=>row.value);
const failures=fetched.filter(row=>!row.ok).map(row=>({volid:row.item.vol.volid,year:row.item.vol.year,page:row.item.page,error:row.error}));
const perVol=new Map();
for (const page of successes) {
  if (!perVol.has(page.vol.volid)) perVol.set(page.vol.volid,{vol:page.vol,pages:[]});
  perVol.get(page.vol.volid).pages.push(page);
}
const issues=[]; const matches=[];
for (const {vol,pages} of perVol.values()) {
  pages.sort((a,b)=>a.page-b.page);
  const pageDate=pages.find(p=>p.date)?.date || null;
  const date=vol.expected_date || pageDate;
  const featureCount=pages.reduce((sum,p)=>sum+p.entries.length,0);
  const complete=pages.length===4 && featureCount===100;
  const date_matches=!pageDate || pageDate===date;
  issues.push({year:vol.year,issue:vol.issue,volid:vol.volid,date,page_date:pageDate,page_count:pages.length,feature_count:featureCount,complete,date_matches});
  if (!complete || !date_matches) continue;
  for (const page of pages) for (let i=0;i<page.entries.length;i+=1) {
    const entry=page.entries[i];
    const group=groupFor(entry);
    if (!group) continue;
    matches.push({date,year:vol.year,issue:vol.issue,volid:vol.volid,group,rank:(page.page-1)*30+i+1,singer:singerFor(entry),title:titleFor(entry),album_id:entry?.album_id ?? null,album_audio_id:entry?.album_audio_id ?? null,audio_id:entry?.audio_id ?? entry?.scid ?? null,hash:entry?.hash ?? entry?.HASH ?? null,source:'kugou_legacy_web'});
  }
}
issues.sort((a,b)=>a.date.localeCompare(b.date)||a.volid-b.volid);
matches.sort((a,b)=>a.date.localeCompare(b.date)||a.rank-b.rank||a.group.localeCompare(b.group));
const counts=Object.fromEntries(Object.keys(aliases).map(group=>[group,matches.filter(row=>row.group===group).length]));
const issueCounts=Object.fromEntries(Object.keys(aliases).map(group=>[group,new Set(matches.filter(row=>row.group===group).map(row=>`${row.date}|${row.volid}`)).size]));
const completeDates=issues.filter(row=>row.complete&&row.date_matches).map(row=>row.date);
const summary={observed_at:observedAt,rank_id:RANK_ID,volume_count:volumes.length,page_requests:tasks.length,successful_pages:successes.length,failed_pages:failures.length,complete_issues:completeDates.length,earliest_recovered_date:completeDates[0]??null,latest_recovered_date:completeDates.at(-1)??null,matches:matches.length,group_match_rows:counts,group_matched_issues:issueCounts,failures};
fs.writeFileSync('kugou-pre2021-web-history-backfill.json',`${JSON.stringify({summary,issues,matches},null,2)}\n`);
const columns=['date','year','issue','volid','group','rank','singer','title','album_id','album_audio_id','audio_id','hash','source'];
fs.writeFileSync('kugou-pre2021-web-history-backfill.csv',[columns.join(','),...matches.map(row=>columns.map(column=>csvEscape(row[column])).join(','))].join('\n')+'\n');
console.log(JSON.stringify({...summary,first_matches:matches.slice(0,20),last_matches:matches.slice(-20)},null,2));
