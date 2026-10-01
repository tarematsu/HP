import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardLegend,
  dashboardMetric,
  dashboardMetrics,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

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
      })}`,
  },
});
