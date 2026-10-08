import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardLegend,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261004.1';

const followersTable = dashboardTable({
  className: 'followers-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="followers-account-col"><col class="followers-affiliation-col"><col><col><col></colgroup>',
  headId: 'followersThead',
  bodyId: 'followersTbody',
  numeric: false,
});

const followersMeta = `
  <div id="followersCompactMeta" class="regional-chart-meta">
    <span>更新日時 <strong id="followersUpdatedAt">-</strong></span>
    <span>更新周期 <strong id="followersCadence">-</strong></span>
  </div>`;

mountDashboardShell({
  view: {
    id: 'followersView',
    className: 'followers-view',
    anchorId: 'historyView',
    position: 'afterend',
    html: `
      ${followersMeta}
      <h2 id="followersPageTitle" class="dashboard-view-title">フォロワー数推移</h2>
      ${dashboardNotice({ id: 'followersNotice' })}
      ${dashboardChartCard({
        id: 'followersChartPanel',
        title: '',
        titleId: 'followersChartTitle',
        kicker: 'FOLLOW',
        trailingHtml: dashboardLegend({
          id: 'followersLegend',
          className: 'chart-legend followers-legend',
          ariaLabel: 'フォロワー数の最新値',
        }),
        chartHtml: '<div class="chart-fit"><canvas id="followersChart" width="960" height="360" aria-label="フォロワー数推移"></canvas><p id="followersChartEmpty" class="shared-empty" hidden>推移データはありません。</p></div>',
        detailHtml: '<div id="followersChartDetail" class="chart-detail"></div>',
        className: 'chart-card',
      })}
      ${dashboardDataCard({
        title: '',
        titleId: 'followersTableTitle',
        kicker: 'LATEST',
        bodyHtml: followersTable,
      })}`,
  },
});
