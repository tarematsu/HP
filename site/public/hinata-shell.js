import {
  dashboardChartCard,
  dashboardChartHost,
  dashboardDataCard,
  dashboardLegend,
  dashboardMetric,
  dashboardMetrics,
  dashboardNotice,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const liveLegend = dashboardLegend({
  className: 'hinata-legend',
  items: [
    '<span><i class="hinata-line-key"></i>オンライン</span>',
    '<span><i class="hinata-bar-key"></i>再生数増加</span>',
  ],
});

const dailyTable = dashboardTable({
  className: 'hinata-daily-table daily-stats-table',
  headers: ['日付', '平均同接', '最小同接', '最大同接', '再生数（開始）', '再生数（終了）', '再生数増加', 'メンバー数（開始）', 'メンバー数（終了）', 'メンバー増加数'],
  bodyId: 'hinataDailyTbody',
});

mountDashboardShell({
  tab: {
    view: 'hinata',
    label: '日向坂',
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
        dashboardMetric({ label: 'オンライン', valueId: 'hinataOnline', value: '—' }),
        dashboardMetric({ label: '総再生数', valueId: 'hinataStreams', value: '—' }),
        dashboardMetric({ label: '総メンバー数', valueId: 'hinataMembers', value: '—' }),
      ], { ariaLabel: '日向坂 Stationhead 最新値' })}
      ${dashboardChartCard({
        title: 'オンライン・再生数増加',
        titleId: 'hinataChartTitle',
        kicker: 'OHISAMA / 24H',
        trailingHtml: '<span id="hinataUpdated" class="pill">—</span>',
        legendHtml: liveLegend,
        chartHtml: dashboardChartHost({
          id: 'hinataChart',
          className: 'hinata-chart chart-fit',
          ariaLabel: '過去24時間のオンライン数と5分ごとの再生数増加',
        }),
        detailHtml: '<p id="hinataChartDetail" class="chart-detail subtle"></p>',
        className: 'chart-card hinata-chart-panel',
      })}
      ${dashboardChartCard({
        title: '同接・再生数増加の推移',
        titleId: 'hinataDailyChartTitle',
        kicker: 'DAILY',
        legendHtml: dashboardLegend({
          id: 'hinataDailyChartLegend',
          className: 'hinata-legend',
          ariaLabel: '日次グラフ凡例',
        }),
        chartHtml: dashboardChartHost({
          id: 'hinataDailyChart',
          className: 'hinata-chart chart-fit',
          ariaLabel: '日次の平均・最大・最小同接と再生数増加',
        }),
        detailHtml: '<p id="hinataDailyChartDetail" class="chart-detail subtle"></p>',
        className: 'chart-card hinata-daily-chart-panel',
      })}
      ${dashboardDataCard({
        title: '日次データ',
        titleId: 'hinataDailyTitle',
        kicker: 'DAILY',
        bodyHtml: dailyTable,
        className: 'hinata-daily-panel',
      })}`,
  },
});
