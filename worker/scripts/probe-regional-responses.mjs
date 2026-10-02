import { mkdir, writeFile } from 'node:fs/promises';
import { REGIONAL_MUSIC_SERVICE_COLLECTORS_BY_ID } from '../src/regional-music-entry.js';
const directory = '../regional-response-evidence';
await mkdir(directory, { recursive: true });
const services = ['genie','joox','kkbox','qq_music','netease_cloud_music','kugou_music','yandex_music','boomplay','plern','fungjai','jiosaavn','gaana','zing_mp3','langit_musik'];
const summary = [];
for (let start = 0; start < services.length; start += 4) {
  await Promise.all(services.slice(start,start+4).map(async (service) => {
    let sequence = 0;
    const requests = [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    const db = { prepare() { return { bind() { return this; }, async run() { return { success:true }; }, async all() { return { results:[] }; }, async first() { return null; } }; } };
    try {
      const result = await REGIONAL_MUSIC_SERVICE_COLLECTORS_BY_ID[service]({ OTHER_DB: db }, Date.now(), async (url, options={}) => {
        const index = ++sequence;
        const response = await fetch(url, { ...options, signal:controller.signal });
        const body = await response.clone().text();
        const filename = `${service}-${String(index).padStart(2,'0')}.txt`;
        await writeFile(`${directory}/${filename}`,body.slice(0,2_000_000));
        requests.push({ url:String(url), status:response.status, content_type:response.headers.get('content-type'), filename });
        return response;
      });
      summary.push({ service,result,requests });
    } catch(error) { summary.push({ service,error:error.message,requests }); }
    finally { clearTimeout(timer); }
  }));
}
await writeFile(`${directory}/summary.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary.map(({service,result,error,requests})=>({service,status:result?.status,error,requests:requests.length}))));
// Read-only capture of current official catalog pages for endpoint migrations.
const qqCatalogQuery = encodeURIComponent(JSON.stringify({
  comm: { ct:24, cv:0 },
  req_1: { module:'musichall.song_list_server', method:'GetSingerSongList', param:{ singerMid:'000DG1og3lDmbT', order:1, begin:0, num:20 } },
}));
const pages = [
  ['gaana-current-search', 'https://gsearch.gaana.com/vichitih/go/v2/?geoLocation=IN&query=Sakurazaka46&content_filter=2&include=artist&isRegSrch=0&webVersion=mix&rType=web&autocomplete=0&startIndex=0'],
  ['qq-current-catalog', `https://u.y.qq.com/cgi-bin/musicu.fcg?data=${qqCatalogQuery}`],
  ['jiosaavn-current-catalog', 'https://www.jiosaavn.com/api.php?__call=artist.getArtistPageDetails&_format=json&_marker=0&ctx=web6dot0&api_version=4&artistId=9095179'],
  ['qq-profile', 'https://y.qq.com/n/ryqq/singer/000DG1og3lDmbT'],
  ['kugou-profile', 'https://pcretry.kugou.com/yueku/v8/singer/home/5317322-0-6-r.html'],
  ['langit-search', 'https://play.langitmusik.co.id/cari?search=Sakurazaka46'],
  ['gaana-home', 'https://gaana.com/'],
  ['jiosaavn-profile', 'https://www.jiosaavn.com/artist/_/9095179'],
  ['gaana-current-js', 'https://static.gaanacdn.com/main.ba25b939.js'],
  ['langit-public-api', 'https://play.langitmusik.co.id/services/lmsearch/api/search/song?keyword=Sakurazaka46&limit=10&offset=0'],
  
];
const pageResults = [];
await Promise.all(pages.map(async ([name,url]) => {
  try {
    const response = await fetch(url, { signal:AbortSignal.timeout(30_000) });
    const body = await response.text();
    await writeFile(`${directory}/${name}.html`,body.slice(0,2_000_000));
    const scripts = [...body.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m=>new URL(m[1],response.url).href).slice(-6);
    const scriptResults = [];
    for (const [index,scriptUrl] of scripts.entries()) {
      try {
        const scriptResponse = await fetch(scriptUrl,{signal:AbortSignal.timeout(15_000)});
        await writeFile(`${directory}/${name}-script-${index}.js`,(await scriptResponse.text()).slice(0,4_000_000));
        scriptResults.push({url:scriptUrl,status:scriptResponse.status});
      } catch(error) { scriptResults.push({url:scriptUrl,error:error.message}); }
    }
    pageResults.push({name,url,final_url:response.url,status:response.status,scripts:scriptResults});
  } catch(error) { pageResults.push({name,url,error:error.message}); }
}));
await writeFile(`${directory}/current-pages.json`,JSON.stringify(pageResults,null,2));
