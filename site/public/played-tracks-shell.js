function ensureStylesheet() {
  if (document.querySelector('link[data-played-tracks-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/played-tracks.css?v=20260924.1';
  link.dataset.playedTracksStyles = '1';
  document.head.append(link);
}

function mountTab() {
  const tabs = document.getElementById('modeTabs');
  const likes = tabs?.querySelector('[data-view="likes"]');
  if (!tabs || !likes || tabs.querySelector('[data-view="played-tracks"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = 'played-tracks';
  button.textContent = '再生曲';
  likes.insertAdjacentElement('beforebegin', button);
}

function mountView() {
  const main = document.getElementById('content');
  if (!main || document.getElementById('playedTracksView')) return;
  const likesView = document.getElementById('likesView');
  const section = document.createElement('section');
  section.id = 'playedTracksView';
  section.className = 'dashboard-view played-tracks-view';
  section.hidden = true;
  section.innerHTML = `
    <div class="played-tracks-toolbar">
      <label class="played-tracks-week-toggle" for="playedTracksWeekMode">
        <input id="playedTracksWeekMode" type="checkbox">
        <span>週表示</span>
      </label>
    </div>

    <div class="played-tracks-period-scroller" id="playedTracksPeriodScroller" aria-label="再生曲の表示期間">
      <div class="played-tracks-period-strip" id="playedTracksPeriodStrip" role="list"></div>
    </div>

    <p id="playedTracksNotice" class="notice" role="status" hidden></p>

    <section class="summary-cards played-tracks-summary" aria-label="再生曲集計概要">
      <article><span>延べ再生曲数</span><strong id="playedTracksTotal">-</strong></article>
      <article><span>曲数</span><strong id="playedTracksUnique">-</strong></article>
    </section>

    <section class="card chart-panel">
      <div class="section-head"><div><p class="kicker">COMPOSITION</p><h2>曲別再生割合</h2></div></div>
      <div class="played-tracks-chart-wrap">
        <canvas id="playedTracksChart" width="960" height="360" aria-label="曲別再生割合の円グラフ"></canvas>
      </div>
    </section>

    <section class="card data-panel">
      <div class="section-head"><div><p class="kicker">DATA</p><h2>再生曲一覧</h2></div></div>
      <div class="table-wrap">
        <table class="played-tracks-table">
          <thead><tr><th>曲名</th><th>回数</th><th>割合</th></tr></thead>
          <tbody id="playedTracksTbody"></tbody>
        </table>
      </div>
    </section>`;
  if (likesView) likesView.insertAdjacentElement('beforebegin', section);
  else main.append(section);
}

ensureStylesheet();
mountTab();
mountView();
