import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardLegend,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const comparisonTable = dashboardTable({
  className: 'first-week-table',
  headers: ['シングル', '曲名', 'ストリーミング配信日', 'データ', '出典'],
  bodyId: 'firstWeekTbody',
});

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
      ${dashboardNotice({ id: 'firstWeekNotice' })}
      ${dashboardChartCard({
        title: 'ストリーミング配信後の同接推移',
        titleId: 'firstWeekChartTitle',
        kicker: 'FIRST WEEK COMPARISON',
        trailingHtml: dashboardLegend({
          id: 'firstWeekLegend',
          className: 'chart-legend first-week-legend',
          ariaLabel: '楽曲凡例',
        }),
        className: 'first-week-chart-panel',
        chartHtml: '<canvas id="firstWeekChart" width="960" height="360" aria-label="表題曲の配信初週比較グラフ"></canvas><div class="chart-axis"><span>配信 0時間</span><span>7日</span></div>',
        detailHtml: '<div id="firstWeekChartDetail" class="chart-detail"></div>',
        footerHtml: '<p id="firstWeekChartFoot" class="chart-foot">各楽曲のストリーミング配信日（JST）0:00を0時間として168時間を比較します。</p>',
      })}
      ${dashboardDataCard({
        title: '比較対象',
        kicker: 'RELEASES',
        className: 'first-week-data-panel',
        bodyHtml: comparisonTable,
      })}`,
  },
});
