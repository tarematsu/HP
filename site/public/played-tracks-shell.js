import {
  dashboardChartCard,
  dashboardControls,
  dashboardDataCard,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const controls = dashboardControls({
  className: 'played-tracks-controls',
  ariaLabel: '再生履歴の表示設定',
  bodyHtml: '<div class="played-tracks-period-scroller" id="playedTracksPeriodScroller" aria-label="再生履歴の表示期間"><div class="played-tracks-period-strip" id="playedTracksPeriodStrip" role="list"></div></div><label class="played-tracks-week-toggle" for="playedTracksWeekMode"><input id="playedTracksWeekMode" type="checkbox"><span>週表示</span></label>',
});

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '総再生回数', valueId: 'playedTracksTotal' }),
  dashboardSummaryItem({ label: '楽曲数', valueId: 'playedTracksUnique' }),
], { className: 'played-tracks-summary', ariaLabel: '再生履歴集計概要' });

const tracksTable = dashboardTable({
  className: 'played-tracks-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col><col class="col-number"><col class="col-number"></colgroup>',
  headers: ['曲名', '回数', '割合'],
  bodyId: 'playedTracksTbody',
});

mountDashboardShell({
  tab: {
    view: 'played-tracks',
    label: '再生履歴',
    anchorSelector: '[data-view="likes"]',
    position: 'beforebegin',
  },
  view: {
    id: 'playedTracksView',
    className: 'played-tracks-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `${controls}${dashboardNotice({ id: 'playedTracksNotice' })}${summary}${dashboardChartCard({
      title: '曲別再生割合',
      kicker: 'COMPOSITION',
      chartHtml: '<div class="played-tracks-chart-wrap"><canvas id="playedTracksChart" width="960" height="360" aria-label="曲別再生割合の円グラフ"></canvas></div>',
    })}${dashboardDataCard({
      title: '楽曲別再生一覧',
      kicker: 'DATA',
      bodyHtml: tracksTable,
    })}`,
  },
});
