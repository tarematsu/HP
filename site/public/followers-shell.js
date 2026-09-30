import { mountDashboardShell } from './dashboard-ui-common.js?v=20260930.1';

mountDashboardShell({
  tab: {
    view: 'followers',
    label: 'フォロワー',
    anchorSelector: '[data-view="first-week"]',
    position: 'afterend',
  },
  view: {
    id: 'followersView',
    className: 'followers-view',
    anchorId: 'historyView',
    position: 'afterend',
    html: `
    <p id="followersNotice" class="notice" role="status" hidden></p>

    <section class="card followers-chart-panel" aria-labelledby="followersChartTitle">
      <div class="section-head followers-head">
        <div><p class="kicker">STATIONHEAD FOLLOWERS</p><h2 id="followersChartTitle">フォロワー数推移</h2></div>
        <span id="followersLatestDate" class="pill">-</span>
      </div>
      <div id="followersLegend" class="followers-legend" aria-label="アカウント別の最新フォロワー数"></div>
      <div id="followersChart" class="followers-chart shared-svg-chart" role="img" aria-label="追跡アカウントのフォロワー数推移"></div>
    </section>

    <section class="card data-panel followers-data-panel">
      <div class="section-head"><div><p class="kicker">LATEST</p><h2>最新フォロワー比較</h2></div></div>
      <div class="table-wrap table-fit-mobile">
        <table class="followers-table shared-numeric-table">
          <colgroup><col class="followers-account-col"><col><col><col></colgroup>
          <thead><tr><th>アカウント名</th><th>現在</th><th>前日比</th><th>1週間比</th></tr></thead>
          <tbody id="followersTbody"></tbody>
        </table>
      </div>
    </section>`,
  },
});
