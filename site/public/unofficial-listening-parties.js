const PLACES = Object.freeze([
  'BUDDIES STATIONHEAD',
  'LOCKEY Stationhead',
  'MINIチャンネル',
  'Team IMP.',
  'FELIX STREAM STATION',
  'WithUチャンネル',
  'Ohisama CH.',
  'sugaglobalunion',
  'scopist1ch',
  "乃木坂46fan's Stationhead",
]);
const X_ACCOUNTS = Object.freeze(['skr_Stationhead', 'saku_saka46', 'HNZ_Stationhead', 'ohisama_discord']);
const EVENT_ROWS = Object.freeze([
  ['2024/08/02', '22:30', '櫻坂46 × INI Streaming Party - ロッキン前夜祭コラボパーティー', 0, 0, '1818995243200758205'],
  ['2024/09/06', '22:00', '櫻坂46 × SECRET NUMBER ~Streaming Party~ DAY1', 0, 0, '1831301387424342514'],
  ['2024/09/07', '22:00', '櫻坂46 × SECRET NUMBER ~Streaming Party~ DAY2', 1, 0, '1831301387424342514'],
  ['2024/09/15', '20:30', '櫻坂46 × JO1 ロッキン出演&9thリリース記念コラボパーティー', 0, 0, '1834834469531902262'],
  ['2024/10/25', '23:50', '櫻坂46 × INI Streaming Party 第1夜', 0, 1, '1849435676288196988'],
  ['2024/11/01', '23:00', '櫻坂46 × INI Streaming Party 第2夜', 2, 0, '1851972681962525075'],
  ['2024/12/10', '22:00', '櫻坂46 × IMP. コラボパーティー DAY1', 0, 0, '1866105637178142945'],
  ['2024/12/13', '22:00', '櫻坂46 × IMP. コラボパーティー DAY2', 3, 0, '1866105637178142945'],
  ['2024/12/19', '22:00', '#FELIX ( #StrayKids) × #Sakurazaka46 🌸 Collab Listening Party', 4, 0, '1869336911619494103'],
  ['2024/12/29', '20:30', '櫻坂46 × NiziU Collab Listening Party', 5, 0, '1872235924760735993'],
  ['2024/12/30', '22:30', '櫻坂46 × 日向坂46 コラボリスニングパーティー DAY1', 6, 0, '1872628541235560835'],
  ['2025/01/03', '22:30', '櫻坂46 × 日向坂46 コラボリスニングパーティー DAY2', 0, 0, '1872628541235560835'],
  ['2025/02/28', '22:00', 'SUGA × 櫻坂46 Streaming Party DAY1', 7, 0, '1895453963149078550'],
  ['2025/03/01', '22:00', 'SUGA × 櫻坂46 Streaming Party DAY2', 0, 0, '1895453963149078550'],
  ['2025/05/05', '22:00', 'WHITE SCORPION × 櫻坂46 Stationheadコラボリスニングパーティー DAY1', 0, 0, '1917911905609633908'],
  ['2025/05/10', '22:00', 'WHITE SCORPION × 櫻坂46 Stationheadコラボリスニングパーティー DAY2', 8, 0, '1917911905609633908'],
  ['2025/05/24', '22:00', 'MONSTA X × 櫻坂46 Stationheadコラボリスニングパーティー', 0, 0, '1926293459385675980'],
  ['2025/07/19', '23:00', '#坂道Stationhead DAY1', 9, 2, '1942191880726528064'],
  ['2025/07/20', '21:00', '#坂道Stationhead DAY2', 0, 2, '1942191880726528064'],
  ['2025/07/21', '22:00', '#坂道Stationhead DAY3', 6, 2, '1942191880726528064'],
  ['2025/12/05', '21:00', 'Buddies × U:nity Stationhead コラボリスニングパーティー', 0, 1, '1995810178009366546'],
  ['2026/01/23', '22:00', '日向坂46 × 櫻坂46 #ケヤキダービー', 6, 3, '1999465286874071088'],
]);

export const EVENTS = Object.freeze(EVENT_ROWS.map(([date, time, name, placeIndex, accountIndex, statusId]) => Object.freeze({
  date,
  time,
  name,
  place: PLACES[placeIndex],
  type: 'コラボ',
  source: `https://x.com/${X_ACCOUNTS[accountIndex]}/status/${statusId}`,
})));

const PANEL_ID = 'unofficialListeningPanel';
const TAB_LABEL = 'リスパ';

function removeLegacyUi() {
  document.querySelector('#modeTabs [data-view="unofficial"]')?.remove();
  document.getElementById('unofficialView')?.remove();
}

function mountView() {
  const history = document.getElementById('historyView');
  if (!history || document.getElementById(PANEL_ID)) return;

  const section = document.createElement('section');
  section.id = PANEL_ID;
  section.className = 'card data-panel unofficial-listening-panel';
  section.hidden = true;
  section.innerHTML = `
    <div class="section-head">
      <div><p class="kicker">DATA</p><h2>非公式リスパ一覧</h2></div>
    </div>
    <div class="table-wrap">
      <table class="unofficial-listening-table">
        <thead>
          <tr><th>日付</th><th>開始時刻</th><th>種別</th><th>イベント名</th><th>開催チャンネル</th><th>出典</th></tr>
        </thead>
        <tbody id="unofficialListeningTbody"></tbody>
      </table>
    </div>`;
  history.append(section);

  const tbody = section.querySelector('#unofficialListeningTbody');
  for (const event of EVENTS) {
    const row = document.createElement('tr');
    for (const value of [event.date, event.time, event.type, event.name, event.place]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }

    const sourceCell = document.createElement('td');
    const sourceLink = document.createElement('a');
    sourceLink.href = event.source;
    sourceLink.target = '_blank';
    sourceLink.rel = 'noopener noreferrer';
    sourceLink.textContent = 'X告知';
    sourceCell.append(sourceLink);
    row.append(sourceCell);
    tbody.append(row);
  }
}

function listeningPartyTab() {
  return document.querySelector('#modeTabs [data-mode="broadcasts"]');
}

function syncTab() {
  const panel = document.getElementById(PANEL_ID);
  const tab = listeningPartyTab();
  if (!panel || !tab) return;
  if (tab.textContent !== TAB_LABEL) tab.textContent = TAB_LABEL;
  panel.hidden = !tab.classList.contains('active');
}

function observeListeningPartyTab() {
  const tab = listeningPartyTab();
  if (!tab || tab.dataset.unofficialPanelObserver === '1') return;
  tab.dataset.unofficialPanelObserver = '1';
  new MutationObserver(syncTab).observe(tab, {
    attributes: true,
    attributeFilter: ['class', 'aria-current'],
    childList: true,
    characterData: true,
    subtree: true,
  });
}

function normalizeLegacyRoute() {
  if (location.hash !== '#unofficial') return;
  history.replaceState(null, '', `${location.pathname}${location.search}#broadcasts`);
}

removeLegacyUi();
mountView();
observeListeningPartyTab();
normalizeLegacyRoute();
syncTab();
window.addEventListener('hashchange', () => {
  removeLegacyUi();
  normalizeLegacyRoute();
  syncTab();
});
window.addEventListener('popstate', syncTab);
