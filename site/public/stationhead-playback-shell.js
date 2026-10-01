import { dashboardSectionHead } from './dashboard-ui-common.js?v=20261001.1';

export function stationheadPlaybackCards({
  stationUrl,
  ids,
  nowTitle = '再生中の曲',
  queueTitle = '今後の再生予定',
} = {}) {
  const value = {
    host: ids?.host || 'host',
    link: ids?.link || 'nowPlayingLink',
    fallback: ids?.fallback || 'trackFallback',
    image: ids?.image || 'trackImage',
    title: ids?.title || 'trackTitle',
    artist: ids?.artist || 'trackArtist',
    time: ids?.time || 'trackTime',
    bites: ids?.bites || 'trackBites',
    hint: ids?.hint || 'spotifyHint',
    bar: ids?.bar || 'trackBar',
    queueCount: ids?.queueCount || 'queueCount',
    queue: ids?.queue || 'queue',
    status: ids?.status || 'statusMessage',
  };
  const href = String(stationUrl || 'https://stationhead.com/').replace(/"/g, '&quot;');
  return `<section class="primary-grid">
    <article class="card now-card">
      ${dashboardSectionHead({ kicker: 'NOW PLAYING', title: nowTitle, trailingHtml: `<div id="${value.host}" class="host"></div>`, className: 'now-head' })}
      <a id="${value.link}" class="now-playing" href="${href}" target="_blank" rel="noopener noreferrer" aria-disabled="false"><span class="track-visual" aria-hidden="true"><span id="${value.fallback}" class="track-fallback">♪</span><img id="${value.image}" class="track-image" alt="" width="104" height="104" decoding="async" hidden></span><div class="track-copy"><strong id="${value.title}"></strong><span id="${value.artist}" class="subtle"></span><div class="time-row"><span id="${value.time}">-</span><span id="${value.bites}" hidden></span><span id="${value.hint}">Stationheadを開く</span></div><div class="progress" aria-hidden="true"><i id="${value.bar}"></i></div></div></a>
    </article>
    <article class="card queue-card">
      ${dashboardSectionHead({ kicker: 'UP NEXT', title: queueTitle, trailingHtml: `<span id="${value.queueCount}" class="pill">-</span>`, className: 'queue-head' })}
      <div id="${value.queue}" class="queue" aria-live="polite"></div>
    </article>
  </section>
  <p id="${value.status}" class="status-message" role="status" hidden></p>`;
}
