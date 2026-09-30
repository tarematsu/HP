import { mountDashboardShell } from './dashboard-ui-common.js?v=20260930.1';

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
    <p id="hinataNotice" class="notice" role="status" hidden></p>

    <section class="metrics hinata-metrics" aria-label="日向坂 Stationhead 最新値">
      <article class="metric hinata-metric"><span>オンライン</span><div class="metric-value"><strong id="hinataOnline">—</strong></div></article>
      <article class="metric hinata-metric"><span>総再生数</span><div class="metric-value"><strong id="hinataStreams">—</strong></div></article>
      <article class="metric hinata-metric"><span>総メンバー数</span><div class="metric-value"><strong id="hinataMembers">—</strong></div></article>
    </section>

    <section class="card chart-card hinata-chart-panel" aria-labelledby="hinataChartTitle">
      <div class="section-head chart-head hinata-section-head">
        <div><p class="kicker">OHISAMA / 24H</p><h2 id="hinataChartTitle">オンライン・再生数増加</h2></div>
        <span id="hinataUpdated" class="pill">—</span>
      </div>
      <div class="legend hinata-legend" aria-label="グラフ凡例">
        <span><i class="hinata-line-key"></i>オンライン</span>
        <span><i class="hinata-bar-key"></i>再生数増加</span>
      </div>
      <div id="hinataChart" class="hinata-chart chart-fit shared-svg-chart" role="img" aria-label="過去24時間のオンライン数と5分ごとの再生数増加"></div>
      <p id="hinataChartDetail" class="chart-detail subtle hinata-chart-detail"></p>
    </section>

    <section class="card chart-card hinata-daily-chart-panel" aria-labelledby="hinataDailyChartTitle">
      <div class="section-head chart-head hinata-section-head">
        <div><p class="kicker">DAILY</p><h2 id="hinataDailyChartTitle">同接・再生数増加の推移</h2></div>
      </div>
      <div id="hinataDailyChartLegend" class="legend hinata-legend" aria-label="日次グラフ凡例"></div>
      <div id="hinataDailyChart" class="hinata-chart chart-fit shared-svg-chart" role="img" aria-label="日次の平均・最大・最小同接と再生数増加"></div>
      <p id="hinataDailyChartDetail" class="chart-detail subtle hinata-chart-detail"></p>
    </section>

    <section class="card data-panel hinata-daily-panel" aria-labelledby="hinataDailyTitle">
      <div class="section-head"><div><p class="kicker">DAILY</p><h2 id="hinataDailyTitle">日次データ</h2></div></div>
      <div class="table-wrap table-fit-mobile">
        <table class="hinata-daily-table shared-numeric-table">
          <thead><tr><th>日付</th><th>平均同接</th><th>最小同接</th><th>最大同接</th><th>再生数（開始）</th><th>再生数（終了）</th><th>再生数増加</th><th>メンバー数（開始）</th><th>メンバー数（終了）</th><th>メンバー増加数</th></tr></thead>
          <tbody id="hinataDailyTbody"></tbody>
        </table>
      </div>
    </section>`,
  },
});
