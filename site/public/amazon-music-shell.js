import { mountDashboardShell } from './dashboard-ui-common.js?v=20260930.1';

mountDashboardShell({
  tab: {
    view: 'amazon-music',
    label: 'Amazon Music',
    anchorSelector: '[data-view="spotify"]',
    position: 'afterend',
  },
  view: {
    id: 'amazonMusicView',
    className: 'amazon-music-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
    <p id="amazonMusicNotice" class="notice" role="status" hidden></p>

    <section class="card amazon-rank-panel" aria-labelledby="amazonAllRankTitle">
      <div class="section-head"><div><p class="kicker">AMAZON MUSIC</p><h2 id="amazonAllRankTitle">Amazon総合順位推移</h2></div></div>
      <div id="amazonAllRankChart" class="amazon-rank-chart chart-fit shared-svg-chart" aria-label="櫻坂46楽曲のAmazon Music総合順位推移"></div>
    </section>

    <section class="card data-panel amazon-data-panel">
      <div class="section-head">
        <div><p class="kicker">AMAZON MUSIC TRACKS</p><h2>櫻坂46 全楽曲順位</h2></div>
        <span id="amazonSnapshotDate" class="subtle">-</span>
      </div>
      <div class="table-wrap table-fit-mobile">
        <table class="amazon-table shared-numeric-table">
          <colgroup>
            <col class="amazon-rank-col">
            <col>
          </colgroup>
          <thead><tr><th>Amazon総合順位</th><th>曲名</th></tr></thead>
          <tbody id="amazonMusicTbody"></tbody>
        </table>
      </div>
    </section>`,
  },
});
