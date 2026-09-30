import { mountDashboardShell } from './dashboard-ui-common.js?v=20260930.1';

mountDashboardShell({
  tab: {
    view: 'nogizaka',
    label: '乃木坂',
    anchorSelector: '[data-mode="broadcasts"]',
    position: 'afterend',
  },
  view: {
    id: 'nogizakaListeningPartyView',
    className: 'history-view nogizaka-listening-party-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
      <p id="nogizakaListeningPartyNotice" class="notice" role="status" hidden></p>

      <section class="summary-cards" aria-label="乃木坂46公式リスパ集計概要">
        <article><span>期間数</span><strong id="nogizakaPartyPeriods">-</strong></article>
        <article><span>平均同接</span><strong id="nogizakaPartyAverage">-</strong></article>
        <article><span>最大同接</span><strong id="nogizakaPartyMaximum">-</strong></article>
        <article><span>所要時間</span><strong id="nogizakaPartyDuration">-</strong></article>
      </section>

      <section class="card chart-panel">
        <div class="section-head chart-head">
          <div><p class="kicker">TREND</p><h2>乃木坂 公式リスパ 同接推移</h2></div>
          <div id="nogizakaPartyLegend" class="chart-legend" aria-label="グラフ凡例"></div>
        </div>
        <canvas id="nogizakaPartyChart" width="960" height="360" aria-label="乃木坂46公式リスパの同接推移"></canvas>
        <div class="chart-axis"><span>開始 0分</span><span id="nogizakaPartyChartEnd">-</span></div>
        <p class="chart-foot">横軸は放送開始からの経過時間です。開催中は自動更新します。</p>
      </section>

      <section class="card data-panel">
        <div class="section-head">
          <div><p class="kicker">DATA</p><h2>公式リスパ一覧</h2></div>
          <button id="nogizakaPartyCsv" class="button" type="button">CSV</button>
        </div>
        <div class="table-wrap">
          <table class="official-party-table">
            <thead id="nogizakaPartyThead"></thead>
            <tbody id="nogizakaPartyTbody"></tbody>
          </table>
        </div>
      </section>`,
  },
});
