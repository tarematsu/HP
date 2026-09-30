import {
  dashboardChartCard,
  dashboardChartHost,
  dashboardDataCard,
  dashboardLegend,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '取得地域数', valueId: 'appleRegionCount' }),
  dashboardSummaryItem({ label: '集計日', valueId: 'appleSnapshotDate' }),
], { className: 'apple-summary', ariaLabel: '櫻坂46 Apple Music 地域別順位概要' });

const regionTable = dashboardTable({
  id: 'appleRegionCompareTable',
  className: 'apple-table apple-region-table',
  wrapClassName: 'apple-region-table-wrap',
});

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
      ${dashboardNotice({ id: 'appleMusicNotice' })}
      ${summary}
      ${dashboardChartCard({
        title: '日本の人気曲順位推移',
        titleId: 'appleJapanRankTitle',
        kicker: 'APPLE MUSIC · JAPAN',
        className: 'apple-rank-panel',
        chartHtml: dashboardChartHost({
          id: 'appleRankChart',
          className: 'apple-rank-chart chart-fit',
          ariaLabel: '日本のApple Music櫻坂46人気曲順位推移',
          role: '',
        }),
        legendHtml: dashboardLegend({
          id: 'appleRankLegend',
          className: 'apple-rank-legend',
          ariaLabel: '日本の現在順位',
        }),
      })}
      ${dashboardDataCard({
        title: '地域別人気順位一覧',
        titleId: 'appleRegionCompareTitle',
        kicker: 'REGION COMPARISON',
        className: 'apple-data-panel',
        bodyHtml: regionTable,
      })}`,
  },
});