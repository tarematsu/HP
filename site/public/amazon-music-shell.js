function ensureStylesheet() {
  if (document.querySelector('link[data-amazon-music-tab-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/amazon-music.css?v=20260929.1';
  link.dataset.amazonMusicTabStyles = '1';
  document.head.append(link);
}

function mountTab() {
  const tabs = document.getElementById('modeTabs');
  if (!tabs || tabs.querySelector('[data-view="amazon-music"]')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = 'amazon-music';
  button.textContent = 'Amazon Music';
  const spotify = tabs.querySelector('[data-view="spotify"]');
  if (spotify) spotify.insertAdjacentElement('afterend', button);
  else tabs.append(button);
}

function mountView() {
  const main = document.getElementById('content');
  if (!main || document.getElementById('amazonMusicView')) return;
  const likesView = document.getElementById('likesView');
  const section = document.createElement('section');
  section.id = 'amazonMusicView';
  section.className = 'dashboard-view amazon-music-view';
  section.hidden = true;
  section.innerHTML = `
    <p id="amazonMusicNotice" class="notice" role="status" hidden></p>

    <section class="summary-cards amazon-summary" aria-label="櫻坂46 Amazon Music フォロワー概要">
      <article><span>フォロワー数</span><strong id="amazonFollowerCount">-</strong></article>
      <article><span>前日比</span><strong id="amazonFollowerDelta">-</strong></article>
    </section>

    <section class="card amazon-rank-panel" aria-labelledby="amazonAllRankTitle">
      <div class="section-head"><div><p class="kicker">AMAZON MUSIC</p><h2 id="amazonAllRankTitle">全楽曲 Amazon総合順位推移</h2></div></div>
      <div id="amazonAllRankChart" class="amazon-rank-chart chart-fit" aria-label="櫻坂46全楽曲のAmazon Music総合順位推移"></div>
    </section>

    <section class="card amazon-rank-panel" aria-labelledby="amazonPopularRankTitle">
      <div class="section-head"><div><p class="kicker">SAKURAZAKA46 POPULAR</p><h2 id="amazonPopularRankTitle">櫻坂46内 人気曲順位推移</h2></div></div>
      <div id="amazonPopularRankChart" class="amazon-rank-chart chart-fit" aria-label="Amazon Music櫻坂46アーティストページ内の人気曲順位推移"></div>
    </section>

    <section class="card data-panel amazon-data-panel">
      <div class="section-head">
        <div><p class="kicker">AMAZON MUSIC TRACKS</p><h2>櫻坂46 全楽曲順位</h2></div>
        <span id="amazonSnapshotDate" class="subtle">-</span>
      </div>
      <div class="table-wrap table-fit-mobile">
        <table class="amazon-table">
          <colgroup>
            <col class="amazon-rank-col">
            <col class="amazon-rank-col">
            <col>
          </colgroup>
          <thead><tr><th>Amazon総合順位</th><th>櫻坂内人気順</th><th>曲名</th></tr></thead>
          <tbody id="amazonMusicTbody"></tbody>
        </table>
      </div>
    </section>`;
  if (likesView) likesView.insertAdjacentElement('beforebegin', section);
  else main.append(section);
}

ensureStylesheet();
mountTab();
mountView();
