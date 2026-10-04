import {
  dashboardChartCard,
  dashboardChartHost,
  dashboardDataCard,
  dashboardLegend,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

// Retain the shared chart-host export in this shell contract while the rendered graph uses Canvas.
void dashboardChartHost;

const followersTable = dashboardTable({
  className: 'followers-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="followers-account-col"><col class="followers-affiliation-col"><col><col><col></colgroup>',
  headers: ['アカウント名', '所属', 'フォロワー数', '前日比', '1週間前比'],
  bodyId: 'followersTbody',
});

const followersMeta = `
  <div id="followersCompactMeta" class="regional-chart-meta">
    <span>更新日時 <strong id="followersUpdatedAt">-</strong></span>
    <span>更新周期 <strong>毎日00:00</strong></span>
  </div>`;

mountDashboardShell({
  view: {
    id: 'followersView',
    className: 'followers-view',
    anchorId: 'historyView',
    position: 'afterend',
    html: `
      ${followersMeta}
      ${dashboardNotice({ id: 'followersNotice' })}
      ${dashboardChartCard({
        kicker: 'STATIONHEAD FOLLOWERS',
        trailingHtml: dashboardLegend({
          id: 'followersLegend',
          className: 'chart-legend followers-legend',
          ariaLabel: 'アカウント別の最新フォロワー数',
        }),
        chartHtml: '<div class="chart-fit"><canvas id="followersChart" width="960" height="360" aria-label="追跡アカウントのフォロワー数推移"></canvas><p id="followersChartEmpty" class="shared-empty" hidden>0時の初回収集後にグラフを表示します。</p></div>',
        detailHtml: '<div id="followersChartDetail" class="chart-detail"></div>',
        className: 'chart-card',
      })}
      ${dashboardDataCard({
        title: '最新フォロワー比較',
        kicker: 'LATEST',
        bodyHtml: followersTable,
      })}`,
  },
});
