import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardLegend,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261004.1';

const table = dashboardTable({
  className: 'leaderboard-table',
  wrapClassName: 'table-fit-mobile',
  headId: 'leaderboardThead',
  bodyId: 'leaderboardTbody',
  numeric: false,
});

const meta = `
  <div id="leaderboardCompactMeta" class="regional-chart-meta">
    <span>更新日時 <strong id="leaderboardUpdatedAt">-</strong></span>
    <span>更新周期 <strong id="leaderboardCadence">-</strong></span>
  </div>`;

mountDashboardShell({
  view: {
    id: 'leaderboardView',
    className: 'leaderboard-view',
    anchorId: 'historyView',
    position: 'afterend',
    html: `
      ${meta}
      <h2 id="leaderboardPageTitle" class="dashboard-view-title">Weekly Leaderboad</h2>
      ${dashboardNotice({ id: 'leaderboardNotice' })}
      ${dashboardChartCard({
        id: 'leaderboardChartPanel',
        title: '',
        titleId: 'leaderboardChartTitle',
        kicker: 'LEADERBOARD',
        trailingHtml: dashboardLegend({ id: 'leaderboardLegend', className: 'chart-legend leaderboard-legend' }),
        chartHtml: '<div class="chart-fit"><canvas id="leaderboardChart" width="960" height="360" aria-label="順位推移"></canvas><p id="leaderboardChartEmpty" class="shared-empty" hidden>順位推移データはありません。</p></div>',
        detailHtml: '<div id="leaderboardChartDetail" class="chart-detail"></div>',
        footerHtml: '<p id="leaderboardChartFoot" class="chart-foot"></p>',
        className: 'chart-card leaderboard-chart-card',
      })}
      ${dashboardDataCard({
        title: '',
        titleId: 'leaderboardTableTitle',
        kicker: 'DATA',
        bodyHtml: table,
      })}`,
  },
});
