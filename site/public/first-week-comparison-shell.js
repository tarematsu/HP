import {
  dashboardChartCard,
  dashboardDataCard,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

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
      ${dashboardChartCard({
        title: 'ストリーミング配信後の同接推移',
        titleId: 'firstWeekChartTitle',
        kicker: 'FIRST WEEK COMPARISON',
        trailingHtml: '<div id="firstWeekLegend" class="chart-legend first-week-legend" aria-label="楽曲凡例"></div>',
        className: 'first-week-chart-panel',
        chartHtml: '<canvas id="firstWeekChart" width="960" height="360" aria-label="表題曲の配信初週比較グラフ"></canvas><div class="chart-axis"><span>配信 0時間</span><span>7日</span></div>',
        detailHtml: '<div id="firstWeekChartDetail" class="chart-detail"></div>',
        footerHtml: '<p id="firstWeekChartFoot" class="chart-foot">各楽曲のストリーミング配信日（JST）0:00を0時間として168時間を比較します。</p>',
      })}
      ${dashboardDataCard({
        title: '比較対象',
        kicker: 'RELEASES',
        className: 'first-week-data-panel',
        bodyHtml: '<div class="table-wrap"><table class="first-week-table shared-numeric-table"><thead><tr><th>シングル</th><th>曲名</th><th>ストリーミング配信日</th><th>データ</th><th>出典</th></tr></thead><tbody id="firstWeekTbody"></tbody></table></div>',
      })}`,
  },
});
