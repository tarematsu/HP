import { mountDashboardShell } from './dashboard-ui-common.js?v=20260930.1';

mountDashboardShell({
  tab: {
    view: 'apple-music',
    label: 'Apple Music',
    anchorSelector: '[data-view="spotify"]',
    position: 'beforebegin',
  },
  view: {
    id: 'appleMusicView',
    className: 'apple-music-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
    <p id="appleMusicNotice" class="notice" role="status" hidden></p>

    <section class="summary-cards apple-summary" aria-label="櫻坂46 Apple Music 地域別順位概要">
      <article><span>取得地域</span><strong id="appleRegionCount">-</strong></article>
      <article><span>取得日</span><strong id="appleSnapshotDate">-</strong></article>
    </section>

    <section class="card apple-rank-panel" aria-labelledby="appleJapanRankTitle">
      <div class="section-head">
        <div><p class="kicker">APPLE MUSIC · JAPAN</p><h2 id="appleJapanRankTitle">日本 人気曲順位推移</h2></div>
      </div>
      <div id="appleRankChart" class="apple-rank-chart chart-fit shared-svg-chart" aria-label="日本のApple Music櫻坂46人気曲順位推移"></div>
      <div id="appleRankLegend" class="apple-rank-legend" aria-label="日本の現在順位"></div>
    </section>

    <section class="card data-panel apple-data-panel" aria-labelledby="appleRegionCompareTitle">
      <div class="section-head">
        <div><p class="kicker">REGION COMPARISON</p><h2 id="appleRegionCompareTitle">地域別 人気順位一覧</h2></div>
      </div>
      <div class="table-wrap apple-region-table-wrap">
        <table id="appleRegionCompareTable" class="apple-table apple-region-table shared-numeric-table"></table>
      </div>
    </section>`,
  },
});
