function ensureStylesheet() {
  if (document.querySelector('link[data-spotify-tab-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/spotify.css?v=20260928.5';
  link.dataset.spotifyTabStyles = '1';
  document.head.append(link);
}

function mountTab() {
  const tabs = document.getElementById('modeTabs');
  const likes = tabs?.querySelector('[data-view="likes"]');
  if (!tabs || !likes || tabs.querySelector('[data-view="spotify"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = 'spotify';
  button.textContent = 'Spotify';
  likes.insertAdjacentElement('beforebegin', button);
}

function mountView() {
  const main = document.getElementById('content');
  if (!main || document.getElementById('spotifyView')) return;
  const likesView = document.getElementById('likesView');
  const section = document.createElement('section');
  section.id = 'spotifyView';
  section.className = 'dashboard-view spotify-view';
  section.hidden = true;
  section.innerHTML = `
    <p id="spotifyNotice" class="notice" role="status" hidden></p>

    <section class="summary-cards spotify-summary" aria-label="櫻坂46 Spotify再生数概要">
      <article><span>確定日</span><strong id="spotifySnapshotDate" class="summary-date">-</strong></article>
      <article><span>櫻坂46楽曲数</span><strong id="spotifyTrackCount">-</strong></article>
      <article><span>櫻坂46前日比合計</span><strong id="spotifyTotalDelta">-</strong></article>
    </section>

    <section class="card spotify-trend-panel" aria-labelledby="spotifyTrendTitle">
      <div class="section-head"><div><p class="kicker">FEMALE IDOLS</p><h2 id="spotifyTrendTitle">Spotify 全曲合計 再生数推移</h2></div></div>
      <div id="spotifyTrendCharts" class="spotify-trend-charts" aria-label="収集対象の女性アイドル全アーティストの前日比全曲合計を重ねたグラフ"></div>
    </section>

    <section class="card spotify-trend-panel" aria-labelledby="spotifyTop10YearTrendTitle">
      <div class="section-head"><div><p class="kicker">FEMALE IDOLS</p><h2 id="spotifyTop10YearTrendTitle">Spotify 上位10曲合計(今年限定) 再生数推移</h2></div></div>
      <div id="spotifyTop10YearTrendCharts" class="spotify-trend-charts" aria-label="今年リリース曲に限定した各アーティストの前日比上位10曲の再生数合計を重ねたグラフ"></div>
    </section>

    <section class="card spotify-trend-panel" aria-labelledby="spotifyArtistRankTrendTitle">
      <div class="section-head"><div><p class="kicker">SPOTIFY CHARTS JAPAN</p><h2 id="spotifyArtistRankTrendTitle">Spotify デイリートップアーティスト(日本) 順位推移</h2></div></div>
      <div id="spotifyArtistRankTrendCharts" class="spotify-trend-charts" aria-label="Spotify日本デイリートップアーティストにおける収集対象アーティストの順位推移"></div>
    </section>

    <section class="card data-panel spotify-data-panel">
      <div class="section-head"><div><p class="kicker">SPOTIFY PLAYCOUNTS</p><h2 id="spotifyTableTitle">櫻坂46 再生数一覧</h2></div></div>
      <div class="table-wrap table-fit-mobile">
        <table class="spotify-table">
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
    </section>`;
  if (likesView) likesView.insertAdjacentElement('beforebegin', section);
  else main.append(section);
}

function legendNumericValue(item) {
  const text = String(item.querySelector('.spotify-trend-latest')?.textContent || '').replaceAll(',', '');
  const match = text.match(/[+-]?\d+/);
  return match ? Number(match[0]) : Number.NEGATIVE_INFINITY;
}

function sortLegendByLatestValue(legend) {
  const items = [...legend.children].filter((node) => node.classList?.contains('spotify-trend-legend-item'));
  if (items.length < 2) return;
  const sorted = items.map((item, index) => ({ item, index, value: legendNumericValue(item) }))
    .sort((a, b) => (b.value - a.value) || (a.index - b.index))
    .map(({ item }) => item);
  if (sorted.every((item, index) => item === items[index])) return;
  legend.append(...sorted);
}

function artistNameFromPoint(circle) {
  const text = String(circle.querySelector('title')?.textContent || '');
  const match = text.match(/^(.*?)\s+\d{4}\/\d{1,2}\/\d{1,2}\s+/);
  return match ? match[1] : '';
}

function showSinglePointSeries(container) {
  const svg = container.querySelector('svg.spotify-trend-svg');
  if (!svg) return;

  const lineState = new Map();
  for (const path of svg.querySelectorAll('path.spotify-trend-line')) {
    const artistName = String(path.querySelector('title')?.textContent || '');
    if (!artistName) continue;
    lineState.set(artistName, /\sL\s/.test(String(path.getAttribute('d') || '')));
  }

  for (const circle of svg.querySelectorAll('circle.spotify-trend-point')) {
    if (circle.dataset.spotifySinglePointMarker === '1') continue;
    const artistName = artistNameFromPoint(circle);
    if (!artistName || lineState.get(artistName) === true) continue;

    const x = Number(circle.getAttribute('cx'));
    const y = Number(circle.getAttribute('cy'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    marker.setAttribute('x1', String(x - 5));
    marker.setAttribute('x2', String(x + 5));
    marker.setAttribute('y1', String(y));
    marker.setAttribute('y2', String(y));
    marker.setAttribute('class', 'spotify-trend-line spotify-single-point-line');
    marker.style.setProperty('--spotify-trend-color', circle.style.getPropertyValue('--spotify-trend-color'));
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${artistName}（取得済み1点）`;
    marker.append(title);
    circle.before(marker);
    circle.setAttribute('r', '3.4');
    circle.dataset.spotifySinglePointMarker = '1';
  }
}

function installGraphPostProcessing() {
  const view = document.getElementById('spotifyView');
  if (!view || view.dataset.spotifyGraphPostProcessing === '1') return;
  view.dataset.spotifyGraphPostProcessing = '1';
  const processAll = () => {
    view.querySelectorAll('.spotify-trend-legend').forEach(sortLegendByLatestValue);
    view.querySelectorAll('.spotify-trend-charts').forEach(showSinglePointSeries);
  };
  const observer = new MutationObserver(processAll);
  observer.observe(view, { childList: true, subtree: true });
  processAll();
}

ensureStylesheet();
mountTab();
mountView();
installGraphPostProcessing();
