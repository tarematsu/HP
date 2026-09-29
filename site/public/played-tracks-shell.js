import { mountDashboardShell } from './dashboard-ui-common.js?v=20260930.1';

mountDashboardShell({
  style: { href: '/played-tracks.css?v=20260928.1', key: 'played-tracks' },
  tab: {
    view: 'played-tracks',
    label: '再生履歴',
    anchorSelector: '[data-view="likes"]',
    position: 'beforebegin',
  },
  view: {
    id: 'playedTracksView',
    className: 'played-tracks-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
    <div class="view-toolbar played-tracks-toolbar">
      <label class="played-tracks-week-toggle" for="playedTracksWeekMode">
        <input id="playedTracksWeekMode" type="checkbox">
        <span>週表示</span>
      </label>
    </div>

    <div class="played-tracks-period-scroller" id="playedTracksPeriodScroller" aria-label="再生履歴の表示期間">
      <div class="played-tracks-period-strip" id="playedTracksPeriodStrip" role="list"></div>
    </div>

    <p id="playedTracksNotice" class="notice" role="status" hidden></p>

    <section class="summary-cards played-tracks-summary" aria-label="再生履歴集計概要">
      <article><span>総再生回数</span><strong id="playedTracksTotal">-</strong></article>
      <article><span>楽曲数</span><strong id="playedTracksUnique">-</strong></article>
    </section>

    <section class="card chart-panel">
      <div class="section-head"><div><p class="kicker">COMPOSITION</p><h2>曲別再生割合</h2></div></div>
      <div class="played-tracks-chart-wrap">
        <canvas id="playedTracksChart" width="960" height="360" aria-label="曲別再生割合の円グラフ"></canvas>
      </div>
    </section>

    <section class="card data-panel">
      <div class="section-head"><div><p class="kicker">DATA</p><h2>楽曲別再生一覧</h2></div></div>
      <div class="table-wrap">
        <table class="played-tracks-table shared-numeric-table">
          <thead><tr><th>曲名</th><th>回数</th><th>割合</th></tr></thead>
          <tbody id="playedTracksTbody"></tbody>
        </table>
      </div>
    </section>`,
  },
});
