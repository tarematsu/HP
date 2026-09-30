import {
  dashboardDataCard,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '最終取得', valueId: 'likesLatestAt', valueClassName: 'summary-date' }),
  dashboardSummaryItem({ label: '対象楽曲数', valueId: 'likesTrackCount' }),
  dashboardSummaryItem({ label: '合計いいね数', valueId: 'likesTotalLikes' }),
  dashboardSummaryItem({ label: '合計いいね数（前日比）', valueId: 'likesTotalDelta' }),
], { className: 'likes-summary', ariaLabel: 'いいね集計概要' });

const likesTable = dashboardTable({
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="col-compact"><col><col class="col-artist"><col class="col-number"><col class="col-date"></colgroup>',
  headers: ['順位', '曲名', 'アーティスト', '最新いいね数', '最終取得'],
  bodyId: 'likesTbody',
});

mountDashboardShell({
  view: {
    id: 'likesView',
    className: 'likes-view',
    anchorId: 'historyView',
    position: 'afterend',
    html: `${dashboardNotice({ id: 'likesNotice' })}${summary}${dashboardDataCard({ title: '最新いいねランキング', kicker: 'TOP TRACKS', bodyHtml: '<ol id="likesRankingList" class="like-ranking"></ol>' })}${dashboardDataCard({ title: '楽曲別一覧', kicker: 'DATA', trailingHtml: '<button id="likesCsv" class="button" type="button">CSV</button>', bodyHtml: likesTable })}`,
  },
});
