import { mountDashboardShell } from './dashboard-ui-common.js?v=20260930.1';

mountDashboardShell({
  style: { href: '/spotify.css?v=20260928.5', key: 'spotify' },
  tab: {
    view: 'spotify',
    label: 'Spotify',
    anchorSelector: '[data-view="likes"]',
    position: 'beforebegin',
  },
  view: {
    id: 'spotifyView',
    className: 'spotify-view',
    anchorId: 'likesView',
    position: 'beforebegin',
    html: `
    <p id="spotifyNotice" class="notice" role="status" hidden></p>

    <section class="summary-cards spotify-summary" aria-label="櫻坂46 Spotify再生数概要">
      <article><span>集計日</span><strong id="spotifySnapshotDate" class="summary-date">-</strong></article>
      <article><span>櫻坂46 楽曲数</span><strong id="spotifyTrackCount">-</strong></article>
      <article><span>櫻坂46 再生数前日比合計</span><strong id="spotifyTotalDelta">-</strong></article>
    </section>

    <section class="card spotify-trend-panel" aria-labelledby="spotifyTrendTitle">
      <div class="section-head"><div><p class="kicker">FEMALE IDOLS</p><h2 id="spotifyTrendTitle">Spotify 全曲合計 再生数前日比推移 (上位10アイドル)</h2></div></div>
      <div id="spotifyTrendCharts" class="spotify-trend-charts" aria-label="最新日の全曲合計再生数前日比が大きい女性アイドル上位10組の推移"></div>
    </section>

    <section class="card spotify-trend-panel" aria-labelledby="spotifyTop10YearTrendTitle">
      <div class="section-head"><div><p class="kicker">FEMALE IDOLS</p><h2 id="spotifyTop10YearTrendTitle">Spotify 上位10曲合計(今年限定) 再生数前日比推移 (上位10アイドル)</h2></div></div>
      <div id="spotifyTop10YearTrendCharts" class="spotify-trend-charts" aria-label="今年リリース曲のうち再生数前日比上位10曲の合計が最新日に大きい女性アイドル上位10組の推移"></div>
    </section>

    <section class="card spotify-trend-panel" aria-labelledby="spotifyArtistRankTrendTitle">
      <div class="section-head"><div><p class="kicker">SPOTIFY CHARTS JAPAN</p><h2 id="spotifyArtistRankTrendTitle">Spotify Daily Top Artist (日本) 順位推移</h2></div></div>
      <div id="spotifyArtistRankTrendCharts" class="spotify-trend-charts" aria-label="Spotify日本 Daily Top Artist における収集対象アーティストの順位推移"></div>
    </section>

    <section class="card data-panel spotify-data-panel">
      <div class="section-head"><div><p class="kicker">SPOTIFY PLAYCOUNTS</p><h2 id="spotifyTableTitle">櫻坂46 再生数一覧</h2></div></div>
      <div class="table-wrap table-fit-mobile">
        <table class="spotify-table shared-numeric-table">
          <colgroup>
            <col class="col-compact">
            <col>
            <col class="col-number">
            <col class="col-delta">
          </colgroup>
          <thead><tr><th>順位</th><th>曲名</th><th>累計再生数</th><th>前日比</th></tr></thead>
          <tbody id="spotifyTbody"></tbody>
        </table>
      </div>
    </section>`,
  },
});
