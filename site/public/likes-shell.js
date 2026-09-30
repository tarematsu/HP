import { mountDashboardShell } from './dashboard-ui-common.js?v=20260930.2';

mountDashboardShell({
  view: {
    id: 'likesView',
    className: 'likes-view',
    anchorId: 'historyView',
    position: 'afterend',
    html: `<p id="likesNotice" class="notice" role="status" hidden></p><section class="summary-cards likes-summary" aria-label="いいね集計概要" style="grid-template-columns:repeat(4,minmax(0,1fr)) !important"><article><span>最終取得</span><strong id="likesLatestAt" class="summary-date">-</strong></article><article><span>対象楽曲数</span><strong id="likesTrackCount">-</strong></article><article><span>合計いいね数</span><strong id="likesTotalLikes">-</strong></article><article style="grid-column:auto !important"><span>合計いいね数（前日比）</span><strong id="likesTotalDelta">-</strong></article></section><section class="card data-panel"><div class="section-head"><div><p class="kicker">TOP TRACKS</p><h2>最新いいねランキング</h2></div></div><ol id="likesRankingList" class="like-ranking"></ol></section><section class="card data-panel"><div class="section-head"><div><p class="kicker">DATA</p><h2>楽曲別一覧</h2></div><button id="likesCsv" class="button" type="button">CSV</button></div><div class="table-wrap table-fit-mobile"><table><colgroup><col class="col-compact"><col><col class="col-artist"><col class="col-number"><col class="col-date"></colgroup><thead><tr><th>順位</th><th>曲名</th><th>アーティスト</th><th>最新いいね数</th><th>最終取得</th></tr></thead><tbody id="likesTbody"></tbody></table></div></section>`,
  },
});
