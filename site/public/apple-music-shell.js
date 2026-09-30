import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardSummary,
  dashboardSummaryItem,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '取得地域数', valueId: 'appleRegionCount' }),
  dashboardSummaryItem({ label: '集計日', valueId: 'appleSnapshotDate' }),
], { className: 'apple-summary', ariaLabel: '櫻坂46 Apple Music 地域別順位概要' });

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
      ${summary}
      ${dashboardChartCard({
        title: '日本の人気曲順位推移',
        titleId: 'appleJapanRankTitle',
        kicker: 'APPLE MUSIC · JAPAN',
        className: 'apple-rank-panel',
        chartHtml: '<div id="appleRankChart" class="apple-rank-chart chart-fit shared-svg-chart" aria-label="日本のApple Music櫻坂46人気曲順位推移"></div>',
        legendHtml: '<div id="appleRankLegend" class="apple-rank-legend" aria-label="日本の現在順位"></div>',
      })}
      ${dashboardDataCard({
        title: '地域別人気順位一覧',
        titleId: 'appleRegionCompareTitle',
        kicker: 'REGION COMPARISON',
        className: 'apple-data-panel',
        bodyHtml: '<div class="table-wrap apple-region-table-wrap"><table id="appleRegionCompareTable" class="apple-table apple-region-table shared-numeric-table"></table></div>',
      })}`,
  },
});
