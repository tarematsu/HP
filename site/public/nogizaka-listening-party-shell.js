import {
  dashboardChartCard,
  dashboardDataCard,
  dashboardSummary,
  dashboardSummaryItem,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261001.1';

const summary = dashboardSummary([
  dashboardSummaryItem({ label: '期間数', valueId: 'nogizakaPartyPeriods' }),
  dashboardSummaryItem({ label: '平均同接', valueId: 'nogizakaPartyAverage' }),
  dashboardSummaryItem({ label: '最大同接', valueId: 'nogizakaPartyMaximum' }),
  dashboardSummaryItem({ label: '所要時間', valueId: 'nogizakaPartyDuration' }),
], { ariaLabel: '乃木坂46公式リスパ集計概要' });

mountDashboardShell({
  tab: {
    view: 'nogizaka',
    label: '乃木坂',
    anchorSelectors: ['[data-view="hinata"]', '[data-mode="broadcasts"]'],
    position: 'beforebegin',
  },
  view: {
    id: 'nogizakaListeningPartyView',
    className: 'history-view nogizaka-listening-party-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `<p id="nogizakaListeningPartyNotice" class="notice" role="status" hidden></p>${summary}${dashboardChartCard({
      title: '乃木坂 公式リスパ 同接推移',
      kicker: 'TREND',
      trailingHtml: '<div id="nogizakaPartyLegend" class="chart-legend" aria-label="グラフ凡例"></div>',
      chartHtml: '<canvas id="nogizakaPartyChart" width="960" height="360" style="height:20em" aria-label="乃木坂46公式リスパの同接推移"></canvas><div class="chart-axis"><span>開始 0分</span><span id="nogizakaPartyChartEnd">-</span></div>',
      footerHtml: '<p class="chart-foot">横軸は放送開始からの経過時間です。開催中は自動更新します。</p>',
    })}${dashboardDataCard({
      title: '公式リスパ一覧',
      kicker: 'DATA',
      trailingHtml: '<button id="nogizakaPartyCsv" class="button" type="button">CSV</button>',
      bodyHtml: '<div class="table-wrap"><table class="official-party-table shared-numeric-table"><thead id="nogizakaPartyThead"></thead><tbody id="nogizakaPartyTbody"></tbody></table></div>',
    })}`,
  },
});
