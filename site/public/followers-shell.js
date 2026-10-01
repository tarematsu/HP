import {
  dashboardChartCard,
  dashboardChartHost,
  dashboardDataCard,
  dashboardLegend,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const followersTable = dashboardTable({
  className: 'followers-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="followers-account-col"><col><col><col></colgroup>',
  headers: ['アカウント名', 'フォロワー数', '前日比', '1週間前比'],
  bodyId: 'followersTbody',
});

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
      ${dashboardNotice({ id: 'followersNotice' })}
      ${dashboardChartCard({
        title: 'フォロワー数推移',
        titleId: 'followersChartTitle',
        kicker: 'STATIONHEAD FOLLOWERS',
        className: 'followers-chart-panel',
        legendHtml: dashboardLegend({
          id: 'followersLegend',
          className: 'followers-legend',
          ariaLabel: 'アカウント別の最新フォロワー数',
        }),
        chartHtml: dashboardChartHost({
          id: 'followersChart',
          className: 'followers-chart',
          ariaLabel: '追跡アカウントのフォロワー数推移',
        }),
      })}
      ${dashboardDataCard({
        title: '最新フォロワー比較',
        kicker: 'LATEST',
        className: 'followers-data-panel',
        bodyHtml: followersTable,
      })}`,
  },
});
