import {
  dashboardDataCard,
  dashboardSummary,
  dashboardSummaryItem,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '最終取得', valueId: 'likesLatestAt', className: 'summary-date' }),
  dashboardSummaryItem({ label: '対象楽曲数', valueId: 'likesTrackCount' }),
  dashboardSummaryItem({ label: '合計いいね数', valueId: 'likesTotalLikes' }),
  dashboardSummaryItem({ label: '合計いいね数（前日比）', valueId: 'likesTotalDelta' }),
], { className: 'likes-summary', ariaLabel: 'いいね集計概要' });

mountDashboardShell({
  view: {
    id: 'likesView',
    className: 'likes-view',
    anchorId: 'historyView',
    position: 'afterend',
    html: `<p id="likesNotice" class="notice" role="status" hidden></p>${summary}${dashboardDataCard({ title: '最新いいねランキング', kicker: 'TOP TRACKS', bodyHtml: '<ol id="likesRankingList" class="like-ranking"></ol>' })}${dashboardDataCard({ title: '楽曲別一覧', kicker: 'DATA', trailingHtml: '<button id="likesCsv" class="button" type="button">CSV</button>', bodyHtml: '<div class="table-wrap table-fit-mobile"><table class="shared-numeric-table"><colgroup><col class="col-compact"><col><col class="col-artist"><col class="col-number"><col class="col-date"></colgroup><thead><tr><th>順位</th><th>曲名</th><th>アーティスト</th><th>最新いいね数</th><th>最終取得</th></tr></thead><tbody id="likesTbody"></tbody></table></div>' })}`,
  },
});
