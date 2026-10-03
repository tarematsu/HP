import{r as e}from"./chunk-2LGKC3RA.js";function c({stationUrl:i,ids:a,nowTitle:s="再生中の曲",queueTitle:r="今後の再生予定"}={}){let t={host:a?.host||"host",link:a?.link||"nowPlayingLink",fallback:a?.fallback||"trackFallback",image:a?.image||"trackImage",title:a?.title||"trackTitle",artist:a?.artist||"trackArtist",time:a?.time||"trackTime",bites:a?.bites||"trackBites",hint:a?.hint||"spotifyHint",bar:a?.bar||"trackBar",queueCount:a?.queueCount||"queueCount",queue:a?.queue||"queue",status:a?.status||"statusMessage"},l=String(i||"https://stationhead.com/").replace(/"/g,"&quot;");return`<section class="primary-grid">
    <article class="card now-card">
      ${e({kicker:"NOW PLAYING",title:s,trailingHtml:`<div id="${t.host}" class="host"></div>`,className:"now-head"})}
      <a id="${t.link}" class="now-playing" href="${l}" target="_blank" rel="noopener noreferrer" aria-disabled="false"><span class="track-visual" aria-hidden="true"><span id="${t.fallback}" class="track-fallback">♪</span><img id="${t.image}" class="track-image" alt="" width="104" height="104" decoding="async" hidden></span><div class="track-copy"><strong id="${t.title}"></strong><span id="${t.artist}" class="subtle"></span><div class="time-row"><span id="${t.time}">-</span><span id="${t.bites}" hidden></span><span id="${t.hint}">Stationheadを開く</span></div><div class="progress" aria-hidden="true"><i id="${t.bar}"></i></div></div></a>
    </article>
    <article class="card queue-card">
      ${e({kicker:"UP NEXT",title:r,trailingHtml:`<span id="${t.queueCount}" class="pill">-</span>`,className:"queue-head"})}
      <div id="${t.queue}" class="queue" aria-live="polite"></div>
    </article>
  </section>
  <p id="${t.status}" class="status-message" role="status" hidden></p>`}export{c as a};
