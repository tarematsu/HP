const EVENTS = [
  { date: '2024/06/28', time: '23:30頃', name: '東京ドーム公演 DAY2＋「自業自得」Mix', place: 'sakuramankai', type: '単独', source: 'https://x.com/skr_Stationhead/status/1806693525171613862' },
  { date: '2024/07/03', time: '23:30', name: '東京ドーム公演セトリ再現 Streaming Party', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1808478827800330611' },
  { date: '2024/07/23', time: '22:00', name: '東京ドーム公演セットリスト放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1815726503038181784' },
  { date: '2024/08/02', time: '22:30', name: '櫻坂46 × INI Streaming Party - ロッキン前夜祭コラボパーティー', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1818995243200758205' },
  { date: '2024/08/08', time: '未確認', name: '「自業自得」ミニライブ配信セトリ放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1821514444176056451' },
  { date: '2024/08/13', time: '23:00', name: '櫻坂46メンバーが選ぶ「夏、夕暮れ時に聴きたい曲」放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1823338600790097985' },
  { date: '2024/08/22', time: '23:00', name: '8th Single BACKS LIVE!! DAY2 セトリ放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1826565176511868991' },
  { date: '2024/09/06', time: '22:00', name: '櫻坂46 × SECRET NUMBER ~Streaming Party~ DAY1', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1831301387424342514' },
  { date: '2024/09/07', time: '22:00', name: '櫻坂46 × SECRET NUMBER ~Streaming Party~ DAY2', place: 'LOCKEY Stationhead', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1831301387424342514' },
  { date: '2024/09/11', time: '23:00', name: '新参者 千秋楽公演（夜）セトリ放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1833811037121855940' },
  { date: '2024/09/15', time: '20:30', name: '櫻坂46 × JO1 ロッキン出演&9thリリース記念コラボパーティー', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1834834469531902262' },
  { date: '2024/09/19', time: '23:00', name: '櫻坂46メンバーが選ぶ「秋に聴きたい楽曲」放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1836725210780954749' },
  { date: '2024/09/21', time: '23:00', name: 'ROCK IN JAPAN FESTIVAL 2024 in ひたちなか セトリ放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1837477170719186106' },
  { date: '2024/10/25', time: '23:50', name: '櫻坂46 × INI Streaming Party 第1夜', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/saku_saka46/status/1849435676288196988' },
  { date: '2024/11/01', time: '23:00', name: '櫻坂46 × INI Streaming Party 第2夜', place: 'MINIチャンネル', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1851972681962525075' },
  { date: '2024/11/21', time: '22:00', name: '1st YEAR ANNIVERSARY LIVE DAY2 セトリ放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1859235313698414872' },
  { date: '2024/11/22', time: '22:00', name: '3rd YEAR ANNIVERSARY LIVE DAY2 セトリ放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1859235313698414872' },
  { date: '2024/11/23', time: '23:30', name: '4th YEAR ANNIVERSARY LIVE DAY1 セトリ放送', place: 'sakuramankai2', type: '単独', source: 'https://x.com/skr_Stationhead/status/1860318868453110115' },
  { date: '2024/11/28', time: '23:00', name: '4th YEAR ANNIVERSARY LIVE DAY1 セトリ再放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1862133201277456418' },
  { date: '2024/11/30', time: '23:00', name: 'Clockenflap 2024 櫻坂46セトリ放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1862839067161006131' },
  { date: '2024/12/03', time: '22:30', name: '10th Single BACKS LIVE!! DAY1 セトリ放送', place: 'sakuramankai2', type: '単独', source: 'https://x.com/skr_Stationhead/status/1863930960070541369' },
  { date: '2024/12/04', time: '23:00', name: '10th Single BACKS LIVE!! DAY2 セトリ放送', place: 'sakuramankai2', type: '単独', source: 'https://x.com/skr_Stationhead/status/1864299948415832292' },
  { date: '2024/12/05', time: '23:00', name: '10th Single BACKS LIVE!! DAY3 セトリ放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1864658173019476263' },
  { date: '2024/12/06', time: '22:00', name: '櫻坂46メンバーの「私のクリスマスソング」プレイリスト放送', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1864968169879921121' },
  { date: '2024/12/10', time: '22:00', name: '櫻坂46 × IMP. コラボパーティー DAY1', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1866105637178142945' },
  { date: '2024/12/13', time: '22:00', name: '櫻坂46 × IMP. コラボパーティー DAY2', place: 'Team IMP.', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1866105637178142945' },
  { date: '2024/12/19', time: '22:00', name: '#FELIX ( #StrayKids) × #Sakurazaka46 🌸 Collab Listening Party', place: 'FELIX STREAM STATION', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1869336911619494103' },
  { date: '2024/12/29', time: '20:30', name: '櫻坂46 × NiziU Collab Listening Party', place: 'WithUチャンネル', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1872235924760735993' },
  { date: '2024/12/30', time: '22:30', name: '櫻坂46 × 日向坂46 コラボリスニングパーティー DAY1', place: 'Ohisama CH.', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1872628541235560835' },
  { date: '2025/01/03', time: '22:30', name: '櫻坂46 × 日向坂46 コラボリスニングパーティー DAY2', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1872628541235560835' },
  { date: '2025/02/28', time: '22:00', name: 'SUGA × 櫻坂46 Streaming Party DAY1', place: 'sugaglobalunion', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1895453963149078550' },
  { date: '2025/03/01', time: '22:00', name: 'SUGA × 櫻坂46 Streaming Party DAY2', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1895453963149078550' },
  { date: '2025/04/18', time: '00:00', name: '「Addiction」配信記念リスニング', place: 'BUDDIES STATIONHEAD', type: '単独', source: 'https://x.com/skr_Stationhead/status/1912841803033649541' },
  { date: '2025/05/05', time: '22:00', name: 'WHITE SCORPION × 櫻坂46 Stationheadコラボリスニングパーティー DAY1', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1917911905609633908' },
  { date: '2025/05/10', time: '22:00', name: 'WHITE SCORPION × 櫻坂46 Stationheadコラボリスニングパーティー DAY2', place: 'scopist1ch', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1917911905609633908' },
  { date: '2025/05/24', time: '22:00', name: 'MONSTA X × 櫻坂46 Stationheadコラボリスニングパーティー', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/skr_Stationhead/status/1926293459385675980' },
  { date: '2025/07/19', time: '23:00', name: '#坂道Stationhead DAY1', place: "乃木坂46fan's Stationhead", type: 'コラボ', source: 'https://x.com/HNZ_Stationhead/status/1942191880726528064' },
  { date: '2025/07/20', time: '21:00', name: '#坂道Stationhead DAY2', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/HNZ_Stationhead/status/1942191880726528064' },
  { date: '2025/07/21', time: '22:00', name: '#坂道Stationhead DAY3', place: 'Ohisama CH.', type: 'コラボ', source: 'https://x.com/HNZ_Stationhead/status/1942191880726528064' },
  { date: '2025/12/05', time: '21:00', name: 'Buddies × U:nity Stationhead コラボリスニングパーティー', place: 'BUDDIES STATIONHEAD', type: 'コラボ', source: 'https://x.com/saku_saka46/status/1995810178009366546' },
  { date: '2026/01/23', time: '22:00', name: '日向坂46 × 櫻坂46 #ケヤキダービー', place: 'Ohisama CH.', type: 'コラボ', source: 'https://x.com/ohisama_discord/status/1999465286874071088' },
];

const PANEL_ID = 'unofficialListeningPanel';
const TAB_LABEL = 'リスニングパーティ';

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

export { EVENTS };