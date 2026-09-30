import { mountDashboardShell } from './dashboard-ui-common.js?v=20260930.1';

mountDashboardShell({
  tab: {
    view: 'first-week',
    label: '初週比較',
    anchorSelector: '[data-view="spotify"]',
    position: 'beforebegin',
  },
  view: {
    id: 'firstWeekView',
    className: 'first-week-view',
    html: `
    <p id="firstWeekNotice" class="notice" role="status" hidden></p>

    <section class="card chart-panel first-week-chart-panel">
      <div class="section-head chart-head">
        <div><p class="kicker">FIRST WEEK COMPARISON</p><h2 id="firstWeekChartTitle">ストリーミング配信後の同接推移</h2></div>
        <div id="firstWeekLegend" class="chart-legend first-week-legend" aria-label="楽曲凡例"></div>
      </div>
      <canvas id="firstWeekChart" width="960" height="360" aria-label="表題曲の配信初週比較グラフ"></canvas>
      <div class="chart-axis"><span>配信 0時間</span><span>7日</span></div>
      <div id="firstWeekChartDetail" class="chart-detail"></div>
      <p id="firstWeekChartFoot" class="chart-foot">各楽曲のストリーミング配信日（JST）0:00を0時間として168時間を比較します。</p>
    </section>

    <section class="card data-panel first-week-data-panel">
      <div class="section-head"><div><p class="kicker">RELEASES</p><h2>比較対象</h2></div></div>
      <div class="table-wrap">
        <table class="first-week-table">
          <thead><tr><th>シングル</th><th>曲名</th><th>ストリーミング配信日</th><th>データ</th><th>出典</th></tr></thead>
          <tbody id="firstWeekTbody"></tbody>
        </table>
      </div>
    </section>`,
  },
});
