const RANK_ID = 31312;
const TEST_VOLS = [80379, 48141, 85535, 129499];
const hosts = ['https://mobilecdnbj.kugou.com', 'https://mobilecdn.kugou.com'];
const aliases = ['櫻坂46','桜坂46','Sakurazaka46','樱坂46','日向坂46','Hinatazaka46','乃木坂46','Nogizaka46'];

function norm(v) { return String(v || '').normalize('NFKC').toLowerCase().replace(/\s+/g,''); }
function matches(entry) {
  const s = norm([entry?.filename,entry?.songname,entry?.singername,entry?.remark].filter(Boolean).join(' '));
  return aliases.some(a => s.includes(norm(a)));
}

const out = { observed_at: new Date().toISOString(), rank_id: RANK_ID, requests: [] };
for (const host of hosts) {
  for (const volid of TEST_VOLS) {
    const url = `${host}/api/v3/rank/song?rankid=${RANK_ID}&volid=${volid}&pagesize=100&page=1&plat=0&version=9108`;
    try {
      const response = await fetch(url, {headers:{'user-agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Mobile Safari/537.36','accept':'application/json,*/*'}});
      const text = await response.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      const entries = Array.isArray(json?.data?.info) ? json.data.info : [];
      out.requests.push({host,volid,http_status:response.status,ok:response.ok,api_status:json?.status ?? null,errcode:json?.errcode ?? null,error:json?.error ?? null,total:json?.data?.total ?? null,entry_count:entries.length,issues:[...new Set(entries.map(x=>x?.issue).filter(x=>x!=null))],matches:entries.map((entry,index)=>({rank:index+1,entry})).filter(({entry})=>matches(entry)).map(({rank,entry})=>({rank,issue:entry.issue,filename:entry.filename,songname:entry.songname,remark:entry.remark,album_audio_id:entry.album_audio_id,audio_id:entry.audio_id})),body_sample:text.slice(0,500)});
    } catch (error) {
      out.requests.push({host,volid,ok:false,transport_error:String(error?.stack || error)});
    }
  }
}

for (const host of hosts) {
  const url = `${host}/api/v3/rank/vol?rankid=${RANK_ID}&plat=0&version=9108&ranktype=1`;
  try {
    const response = await fetch(url, {headers:{'user-agent':'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 Mobile Safari/537.36','accept':'application/json,*/*'}});
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    const years = Array.isArray(json?.data?.info) ? json.data.info : [];
    out.requests.push({host,kind:'vol',http_status:response.status,ok:response.ok,api_status:json?.status ?? null,errcode:json?.errcode ?? null,error:json?.error ?? null,years:years.map(y=>({year:y.year,count:Array.isArray(y.vols)?y.vols.length:0,min_volid:Array.isArray(y.vols)&&y.vols.length?Math.min(...y.vols.map(v=>Number(v.volid))):null,max_volid:Array.isArray(y.vols)&&y.vols.length?Math.max(...y.vols.map(v=>Number(v.volid))):null,first:y.vols?.[0],last:y.vols?.at?.(-1)})),body_sample:text.slice(0,500)});
  } catch (error) {
    out.requests.push({host,kind:'vol',ok:false,transport_error:String(error?.stack || error)});
  }
}
console.log(JSON.stringify(out,null,2));
