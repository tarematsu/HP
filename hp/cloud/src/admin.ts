import {
  managedSpotifySevenSlotRotation,
  MANAGED_SPOTIFY_RANDOM_TRACK_IDS,
  SHORT_SPOTIFY_RANDOM_TRACKS,
} from "./spotify_random_catalog";

const spotifySevenSlotRotationJson = JSON.stringify(managedSpotifySevenSlotRotation());
const shortSpotifyRandomTrackIdsJson = JSON.stringify(
  SHORT_SPOTIFY_RANDOM_TRACKS.map(([, id]) => id),
);
const managedSpotifyRandomTrackIdsJson = JSON.stringify(MANAGED_SPOTIFY_RANDOM_TRACK_IDS);

const PAGE = String.raw`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HomePanel Cloud Settings</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3}*{box-sizing:border-box}body{margin:0;padding:24px}main{max-width:980px;margin:auto}section{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:18px;margin:16px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}label{display:grid;gap:6px}input,textarea,button{font:inherit;border:1px solid #3d444d;border-radius:8px;background:#0d1117;color:#e6edf3;padding:10px}textarea{width:100%;min-height:560px;font-family:ui-monospace,monospace}button{cursor:pointer;background:#21262d}.primary{background:#238636}.warn{background:#9e6a03}.row{display:flex;gap:10px;flex-wrap:wrap}.status{min-height:24px;margin-top:10px;color:#79c0ff}.muted{font-size:13px;color:#8b949e}@media(max-width:700px){.grid{grid-template-columns:1fr}}
</style></head><body><main>
<h1>HomePanel Cloud Settings</h1><p>Cloudflare上の端末設定と遠隔操作を管理します。</p>
<section><div class="grid"><label>Device ID<input id="deviceId" value="primary"></label><label>管理トークン<input id="token" type="password"></label></div>
<div class="row" style="margin-top:12px"><button id="load" class="primary">クラウド設定を読み込む</button><button id="save" class="primary">保存</button></div><div id="status" class="status"></div><div class="muted">Spotifyは spotify.rotation の fixed / shuffle / random ブロックを上から順に再生します。tracks配列は任意件数、randomのみcountで1サイクルに採用する件数を指定できます。同一サイクルでは同じSpotify pathを重複採用しません。randomに includeTalkAbout:true を指定すると、最新TALKABOUTエピソードもその抽選候補に加えます。端末への反映は次回クラウド同期時です。</div></section>
<section><label>端末設定 JSON<textarea id="config" spellcheck="false"></textarea></label></section>
<section><h2>遠隔操作</h2><div class="row" id="commands"><button data-command="check_update">更新確認</button></div></section>
</main><script>
const managedSpotifyRotation=${spotifySevenSlotRotationJson};
const shortSpotifyRandomTrackIds=${shortSpotifyRandomTrackIdsJson};
const managedSpotifyRandomTrackIds=${managedSpotifyRandomTrackIdsJson};
const legacySpotifyRandomTrackIds=["4ljk3qMzdU81kWzxcNix3F","2hi8kIoKC8tRMDajdkoYFL","2kiCcs4rC55nlHQ1djMTt6","3HdmFZGqZLNiCAfiNj4N84","145bvRRC27wMYn9GNtTg57","6GF0ZgT8wlksWrlLTfGmlU","4HCPWhwMu93z1jnpxw5OGM","7vvZ1QHTdkoEXBiOBdxdIo","6QmAwjzLQy6SjUyvGzSCG4","3SOOYBTDQBUe9vkavji2ZI","5vRGSkQiKlJudkJ2vUKIOe","4YUoggoqC3KIxts61kmlqw","6ZOaQShLJdbZYvPoi1xOdE","0yv01vKbOmS1UMS9XyN5ar","6O3XAkrjMG1T4x8jvdpbrp","4J2JsdELLCewlR7kISsw70","6jxiPZV3Aopxbi33i09uFQ","12YgUwcZKUCnYWccet8qJq","4AZXBU2rt8yCcEA1pttXLB","6ncW1pJ5bHOum76AL2P08a","6whOTYjcMh396LLbqig8jq","49cxVtrML7Xo63UFaaJrUR","2MPm0NrgPoMr6ee7je9afe","5DrxCKjopmd7UL1pJWqBHK","4PaLKbIU8NvguxcrjMvHXh","6J8Vaiow1E75EQs9RnMfZp","5xUQGRuP4LPk4ESl1xbmFs","11KKagWroMV5UXbK50hZxZ","33liCluqUasE65nMv3KLLm","5QnQ7m9OxSoFeSPSz8grqX","2ze5Hu3eRRe6HxJTfuZaA0","4IfRFec7SNKOWw1HzpiqHQ","2CMSkSwIfnNQR7bTNFFeB5","2meBhRDzQpf0ltQH11HbWG"];
const legacySpotifyMiddleTrackIds=["5EjWZuODqEPQ9eq7XCmITh","6VIY7OFy8g5ZyLSgQEi8lV","0rUT5nQpBjkg4SPY8jPjcO","2UHNvd8SjNGoEI6jXa2afx"];
const defaults={cloudPollSeconds:1800,telemetryMinutes:240,screen:{width:1920,height:1280},co2:{serialPort:"",temperatureOffset:-4.5},stationhead:{url:"https://www.stationhead.com/sakuramankai",fallbackUrl:"https://www.stationhead.com/buddy46",healthCheckIntervalSeconds:60,restartAfterHealthMisses:3,blockImages:true,blockFonts:true,lowMemoryMode:true,memoryLimitMb:450,secondary:{enabled:true,url:"https://www.stationhead.com/sakuramankai"}},spotify:{rotation:structuredClone(managedSpotifyRotation),talkAbout:{url:"https://open.spotify.com/show/2ZQy2mlwQodabAILwZ02Ed",intervalMinutes:120,playbackRate:3}},updates:{manifestUrl:location.origin+"/v1/update/manifest"}};
const byId=id=>document.getElementById(id),status=message=>{byId("status").textContent=message};let loadedDeviceId="",loadedVersion=null;
const merge=(base,extra)=>{const output=structuredClone(base);if(!extra||typeof extra!=="object"||Array.isArray(extra))return output;for(const [key,value] of Object.entries(extra)){if(value&&typeof value==="object"&&!Array.isArray(value)&&output[key]&&typeof output[key]==="object")output[key]=merge(output[key],value);else output[key]=value}output.cloudPollSeconds=1800;output.telemetryMinutes=240;return output};
const trackIds=group=>(Array.isArray(group?.tracks)?group.tracks:[]).map(track=>String(track?.url||"").match(/\/track\/([A-Za-z0-9]{22})(?:[/?#]|$)/)?.[1]||"");
const sameTrackSet=(actual,expected)=>actual.length===expected.length&&expected.every(id=>actual.includes(id));
const managedRandomPool=ids=>(ids.length===legacySpotifyRandomTrackIds.length&&ids.every((id,index)=>id===legacySpotifyRandomTrackIds[index]))||(ids.length>=shortSpotifyRandomTrackIds.length&&ids.length<=managedSpotifyRandomTrackIds.length&&ids.every((id,index)=>id===managedSpotifyRandomTrackIds[index]));
const migrate=config=>{const output=structuredClone(config||{}),station=output.stationhead;if(station&&typeof station==="object"&&!Array.isArray(station)){if(!Object.hasOwn(station,"blockImages")&&Object.hasOwn(station,"blockImagesAfterPlayback"))station.blockImages=station.blockImagesAfterPlayback;if(!Object.hasOwn(station,"blockFonts")&&Object.hasOwn(station,"blockFontsAfterPlayback"))station.blockFonts=station.blockFontsAfterPlayback;delete station.blockImagesAfterPlayback;delete station.blockFontsAfterPlayback;delete station.hideChatAfterPlayback}const rotation=output.spotify?.rotation;if(Array.isArray(rotation)&&rotation.length===3){const first=rotation[0],middle=rotation[1],random=rotation[2],firstIds=trackIds(first),middleIds=trackIds(middle),randomIds=trackIds(random);if(first?.mode==="fixed"&&middle?.mode==="shuffle"&&random?.mode==="random"&&Number(random?.count??1)===1&&firstIds.length===1&&firstIds[0]==="6Vy6hCA2CZwZalGqaX6Sew"&&sameTrackSet(middleIds,legacySpotifyMiddleTrackIds)&&managedRandomPool(randomIds))output.spotify.rotation=structuredClone(managedSpotifyRotation)}return output};
const credentials=()=>{const token=byId("token").value.trim(),deviceId=byId("deviceId").value.trim();if(!token)throw new Error("管理トークンを入力してください");if(!/^[A-Za-z0-9._-]{1,100}$/.test(deviceId))throw new Error("Device IDが不正です");sessionStorage.setItem("homepanelToken",token);localStorage.setItem("homepanelDeviceId",deviceId);return{token,deviceId}};
const call=async(path,options={})=>{const{token}=credentials();const response=await fetch(path,{...options,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",...(options.headers||{})}});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||("HTTP "+response.status));return body};
async function load(){try{status("読み込み中...");const{deviceId}=credentials(),body=await call("/v1/device/config?deviceId="+encodeURIComponent(deviceId));loadedDeviceId=deviceId;loadedVersion=Number(body.version||0);byId("config").value=JSON.stringify(merge(defaults,migrate(body.config)),null,2);status("クラウド設定を読み込みました。version "+loadedVersion)}catch(error){status(error.message||String(error))}}
async function save(){try{status("保存中...");const{deviceId}=credentials();if(loadedVersion===null||loadedDeviceId!==deviceId)throw new Error("保存前にこのDevice IDの設定を読み込んでください");const config=JSON.parse(byId("config").value);config.cloudPollSeconds=1800;config.telemetryMinutes=240;const body=await call("/v1/device/config?deviceId="+encodeURIComponent(deviceId),{method:"PUT",headers:{"If-Match":"\"device-config-"+deviceId+"-"+loadedVersion+"\""},body:JSON.stringify(config)});loadedVersion=Number(body.version||loadedVersion);status(body.changed===false?"変更はありません":"保存しました。次回クラウド同期でSpotify設定を反映します。version "+loadedVersion)}catch(error){status(error.message||String(error))}}
byId("load").addEventListener("click",load);byId("save").addEventListener("click",save);byId("commands").addEventListener("click",async event=>{const command=event.target?.dataset?.command;if(!command)return;try{status(command+" を登録中...");const{deviceId}=credentials(),body=await call("/v1/device/commands",{method:"POST",body:JSON.stringify({deviceId,command})});status(command+" を登録しました。command id "+body.id)}catch(error){status(error.message||String(error))}});
byId("token").value=sessionStorage.getItem("homepanelToken")||"";byId("deviceId").value=localStorage.getItem("homepanelDeviceId")||"primary";byId("config").value=JSON.stringify(defaults,null,2);
</script></body></html>`;

export function adminPage(): Response {
  return new Response(PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
