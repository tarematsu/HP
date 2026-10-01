import {
  dashboardChartCard,
  dashboardControls,
  dashboardDataCard,
  dashboardLegend,
  dashboardMetric,
  dashboardMetrics,
  dashboardModeTabs,
  dashboardNotice,
  dashboardSummary,
  dashboardSummaryItem,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';
import { stationheadPlaybackCards } from './stationhead-playback-shell.js?v=20261001.1';

const liveLegend = dashboardLegend({
  items: [
    '<span class="online-key">オンライン</span>',
    '<span class="stream-growth-key">再生数増加</span>',
  ],
});

const dailyTable = dashboardTable({
  className: 'daily-stats-table',
  headers: ['日付', '平均同接', '最小同接', '最大同接', '再生数（開始）', '再生数（終了）', '再生数増加', 'メンバー数（開始）', 'メンバー数（終了）', 'メンバー増加数'],
  bodyId: 'hinataDailyTbody',
});

const playedControls = dashboardControls({
  className: 'played-tracks-controls',
  ariaLabel: 'Ohisama再生履歴の表示期間',
  bodyHtml: '<div class="played-tracks-period-scroller" aria-label="再生履歴の表示期間"><div class="played-tracks-period-strip" id="hinataPlayedPeriodStrip" role="list"></div></div>',
});

const playedSummary = dashboardSummary([
  dashboardSummaryItem({ label: '総再生回数', valueId: 'hinataPlayedTotal' }),
  dashboardSummaryItem({ label: '楽曲数', valueId: 'hinataPlayedUnique' }),
], { className: 'played-tracks-summary', ariaLabel: 'Ohisama再生履歴集計概要' });

const playedTable = dashboardTable({
  className: 'played-tracks-table',
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col><col class="col-number"><col class="col-number"></colgroup>',
  headers: ['曲名', '回数', '割合'],
  bodyId: 'hinataPlayedTbody',
});

const likesSummary = dashboardSummary([
  dashboardSummaryItem({ label: '最終取得', valueId: 'hinataLikesLatestAt', valueClassName: 'summary-date' }),
  dashboardSummaryItem({ label: '対象楽曲数', valueId: 'hinataLikesTrackCount' }),
  dashboardSummaryItem({ label: '合計いいね数', valueId: 'hinataLikesTotalLikes' }),
], { className: 'likes-summary', ariaLabel: 'Ohisamaいいね集計概要' });

const likesTable = dashboardTable({
  wrapClassName: 'table-fit-mobile',
  colgroupHtml: '<colgroup><col class="col-compact"><col><col class="col-artist"><col class="col-number"><col class="col-date"></colgroup>',
  headers: ['順位', '曲名', 'アーティスト', '最新いいね数', '最終取得'],
  bodyId: 'hinataLikesTbody',
});

const subtabs = dashboardModeTabs([
  { value: 'current', label: '現在', active: true },
  { value: 'history', label: '過去' },
  { value: 'played-tracks', label: '再生履歴' },
  { value: 'likes', label: 'いいね' },
], {
  dataAttribute: 'hinata-section',
  className: 'hinata-subtabs',
  ariaLabel: 'Ohisama表示切替',
});

mountDashboardShell({
  tab: {
    view: 'hinata',
    label: 'Ohisama',
    anchorSelectors: ['[data-view="amazon-music"]', '[data-view="spotify"]'],
    position: 'afterend',
  },
  view: {
    id: 'hinataView',
    className: 'hinata-view',
    anchorId: 'historyView',
    position: 'afterend',
    html: `
      ${dashboardNotice({ id: 'hinataNotice' })}
      ${dashboardNotice({ id: 'hinataChannelNotice' })}
      ${subtabs}
      <div data-hinata-panel="current">
        ${dashboardMetrics([
          dashboardMetric({ label: 'オンライン', valueId: 'hinataOnline', value: '—', className: 'featured' }),
          dashboardMetric({ label: '総再生数', valueId: 'hinataStreams', value: '—' }),
          dashboardMetric({ label: '総メンバー数', valueId: 'hinataMembers', value: '—' }),
        ], { ariaLabel: '日向坂 Stationhead 最新値' })}
        ${dashboardChartCard({
          title: 'オンライン・再生数増加',
          titleId: 'hinataChartTitle',
          kicker: 'OHISAMA / 24H',
          trailingHtml: `${liveLegend}<small class="subtle">5分単位</small>`,
          chartHtml: '<div class="chart-fit"><canvas id="hinataChart" width="960" height="360" aria-label="過去24時間のオンライン数と5分ごとの再生数増加"></canvas><p id="hinataChartEmpty" class="shared-empty" hidden>グラフデータはまだありません。</p></div>',
          detailHtml: '<div id="hinataChartDetail" class="chart-detail"></div>',
          className: 'chart-card',
        })}
        ${stationheadPlaybackCards({
          stationUrl: 'https://stationhead.com/c/ohisama',
          ids: {
            host: 'hinataHost',
            link: 'hinataNowPlayingLink',
            fallback: 'hinataTrackFallback',
            image: 'hinataTrackImage',
            title: 'hinataTrackTitle',
            artist: 'hinataTrackArtist',
            time: 'hinataTrackTime',
            bites: 'hinataTrackBites',
            hint: 'hinataSpotifyHint',
            bar: 'hinataTrackBar',
            queueCount: 'hinataQueueCount',
            queue: 'hinataQueue',
            status: 'hinataPlaybackStatus',
          },
        })}
      </div>
      <div data-hinata-panel="history" hidden>
        ${dashboardChartCard({
          title: '同接・再生数増加の推移',
          titleId: 'hinataDailyChartTitle',
          kicker: 'DAILY',
          trailingHtml: dashboardLegend({
            id: 'hinataDailyChartLegend',
            className: 'chart-legend',
            ariaLabel: '日次グラフ凡例',
          }),
          chartHtml: '<div class="chart-fit"><canvas id="hinataDailyChart" width="960" height="360" aria-label="日次の平均・最大・最小同接と再生数増加"></canvas><p id="hinataDailyChartEmpty" class="shared-empty" hidden>日次グラフデータはまだありません。</p></div>',
          detailHtml: '<div id="hinataDailyChartDetail" class="chart-detail"></div>',
          footerHtml: '<p id="hinataDailyChartFoot" class="chart-foot"></p>',
          className: 'chart-card',
        })}
        ${dashboardDataCard({
          title: '日次データ',
          titleId: 'hinataDailyTitle',
          kicker: 'DAILY',
          bodyHtml: dailyTable,
        })}
      </div>
      <div data-hinata-panel="played-tracks" hidden>
        ${playedControls}
        ${playedSummary}
        ${dashboardDataCard({
          title: '楽曲別再生一覧',
          kicker: 'DATA',
          bodyHtml: playedTable,
        })}
      </div>
      <div data-hinata-panel="likes" hidden>
        ${likesSummary}
        ${dashboardDataCard({
          title: '最新いいねランキング',
          kicker: 'TOP TRACKS',
          bodyHtml: '<ol id="hinataLikesRankingList" class="like-ranking"></ol>',
        })}
        ${dashboardDataCard({
          title: '楽曲別一覧',
          kicker: 'DATA',
          bodyHtml: likesTable,
        })}
      </div>`,
  },
});

void import('./hinata-channel-tabs.js?v=20261001.1').catch((error) => {
  console.error('Ohisama channel tabs failed to start', error);
});
