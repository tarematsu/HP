const EVENTS = [
  { date: '2024/08/02', time: '22:30', name: '櫻坂46 × INI Streaming Party - ロッキン前夜祭コラボパーティー', place: 'BUDDIES STATIONHEAD', source: 'https://x.com/skr_Stationhead/status/1818995243200758205' },
  { date: '2024/09/06', time: '22:00', name: '櫻坂46 × SECRET NUMBER ~Streaming Party~ DAY1', place: 'BUDDIES STATIONHEAD', source: 'https://x.com/skr_Stationhead/status/1831301387424342514' },
  { date: '2024/09/07', time: '22:00', name: '櫻坂46 × SECRET NUMBER ~Streaming Party~ DAY2', place: 'LOCKEY Stationhead', source: 'https://x.com/skr_Stationhead/status/1831301387424342514' },
  { date: '2024/09/15', time: '20:30', name: '櫻坂46 × JO1 ロッキン出演&9thリリース記念コラボパーティー', place: 'BUDDIES STATIONHEAD', source: 'https://x.com/skr_Stationhead/status/1834834469531902262' },
  { date: '2024/10/25', time: '23:50', name: '櫻坂46 × INI Streaming Party 第1夜', place: 'BUDDIES STATIONHEAD', source: 'https://x.com/saku_saka46/status/1849435676288196988' },
  { date: '2024/11/01', time: '23:00', name: '櫻坂46 × INI Streaming Party 第2夜', place: 'MINIチャンネル', source: 'https://x.com/skr_Stationhead/status/1851972681962525075' },
  { date: '2024/12/10', time: '22:00', name: '櫻坂46 × IMP. コラボパーティー DAY1', place: 'BUDDIES STATIONHEAD', source: 'https://x.com/skr_Stationhead/status/1866105637178142945' },
  { date: '2024/12/13', time: '22:00', name: '櫻坂46 × IMP. コラボパーティー DAY2', place: 'Team IMP.', source: 'https://x.com/skr_Stationhead/status/1866105637178142945' },
  { date: '2024/12/19', time: '22:00', name: '#FELIX ( #StrayKids) × #Sakurazaka46 🌸 Collab Listening Party', place: 'FELIX STREAM STATION', source: 'https://x.com/skr_Stationhead/status/1869336911619494103' },
  { date: '2024/12/29', time: '20:30', name: '櫻坂46 × NiziU Collab Listening Party', place: 'WithUチャンネル', source: 'https://x.com/skr_Stationhead/status/1872235924760735993' },
  { date: '2024/12/30', time: '22:30', name: '櫻坂46 × 日向坂46 コラボリスニングパーティー DAY1', place: 'Ohisama CH.', source: 'https://x.com/skr_Stationhead/status/1872628541235560835' },
  { date: '2025/01/03', time: '22:30', name: '櫻坂46 × 日向坂46 コラボリスニングパーティー DAY2', place: 'BUDDIES STATIONHEAD', source: 'https://x.com/skr_Stationhead/status/1872628541235560835' },
  { date: '2025/07/19', time: '23:00', name: '#坂道Stationhead DAY1', place: "乃木坂46fan's Stationhead", source: 'https://x.com/HNZ_Stationhead/status/1942191880726528064' },
  { date: '2025/07/20', time: '21:00', name: '#坂道Stationhead DAY2', place: 'BUDDIES STATIONHEAD', source: 'https://x.com/HNZ_Stationhead/status/1942191880726528064' },
  { date: '2025/07/21', time: '22:00', name: '#坂道Stationhead DAY3', place: 'Ohisama CH.', source: 'https://x.com/HNZ_Stationhead/status/1942191880726528064' },
];

function mountTab() {
  const tabs = document.getElementById('modeTabs');
  const official = tabs?.querySelector('[data-mode="broadcasts"]');
  if (!tabs || !official || tabs.querySelector('[data-view="unofficial"]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = 'unofficial';
  button.textContent = '非公式リスパ';
  official.insertAdjacentElement('afterend', button);
}

function mountView() {
  const main = document.getElementById('content');
  if (!main || document.getElementById('unofficialView')) return;

  const section = document.createElement('section');
  section.id = 'unofficialView';
  section.className = 'dashboard-view unofficial-view';
  section.hidden = true;
  section.innerHTML = `
    <section class="card data-panel">
      <div class="section-head">
        <div><p class="kicker">DATA</p><h2>非公式リスパ一覧</h2></div>
      </div>
      <div class="table-wrap">
        <table class="unofficial-listening-table">
          <thead>
            <tr><th>日付</th><th>開始時刻</th><th>イベント名</th><th>開催チャンネル</th><th>出典</th></tr>
          </thead>
          <tbody id="unofficialListeningTbody"></tbody>
        </table>
      </div>
    </section>`;
  main.append(section);

  const tbody = section.querySelector('#unofficialListeningTbody');
  for (const event of EVENTS) {
    const row = document.createElement('tr');
    for (const value of [event.date, event.time, event.name, event.place]) {
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

mountTab();
mountView();

export { EVENTS };
