import {
  dashboardChartCard,
  dashboardChartHost,
  dashboardDataCard,
  dashboardNotice,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

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
        trailingHtml: '<span id="followersLatestDate" class="pill">-</span>',
        className: 'followers-chart-panel',
        legendHtml: '<div id="followersLegend" class="followers-legend" aria-label="アカウント別の最新フォロワー数"></div>',
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
        bodyHtml: '<div class="table-wrap table-fit-mobile"><table class="followers-table shared-numeric-table"><colgroup><col class="followers-account-col"><col><col><col></colgroup><thead><tr><th>アカウント名</th><th>フォロワー数</th><th>前日比</th><th>1週間前比</th></tr></thead><tbody id="followersTbody"></tbody></table></div>',
      })}`,
  },
});
