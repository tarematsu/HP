const EVENTS = [
  { date: '2024/08/02', time: '22:30', name: '櫻坂46 × INI Streaming Party - ロッキン前夜祭コラボパーティー', place: '' },
  { date: '2024/09/06', time: '22:00', name: '櫻坂46 × SECRET NUMBER ~Streaming Party~ DAY1', place: '' },
  { date: '2024/09/07', time: '22:00', name: '櫻坂46 × SECRET NUMBER ~Streaming Party~ DAY2', place: '' },
  { date: '2024/09/15', time: '20:30', name: '櫻坂46 × JO1 ロッキン出演&9thリリース記念コラボパーティー', place: '' },
  { date: '2024/10/25', time: '23:50', name: '櫻坂46 × INI Streaming Party 第1夜', place: 'Buddies' },
  { date: '2024/11/01', time: '23:00', name: '櫻坂46 × INI Streaming Party 第2夜', place: 'MINI' },
  { date: '2024/12/10', time: '22:00', name: '櫻坂46 × IMP. コラボパーティー DAY1', place: 'Buddies' },
  { date: '2024/12/13', time: '22:00', name: '櫻坂46 × IMP. コラボパーティー DAY2', place: 'Team IMP.' },
  { date: '2024/12/19', time: '22:00', name: '#FELIX ( #StrayKids) × #Sakurazaka46 🌸 Collab Listening Party', place: '' },
  { date: '2024/12/29', time: '20:30', name: '櫻坂46 × NiziU Collab Listening Party', place: '' },
  { date: '2024/12/30', time: '22:30', name: '櫻坂46 × 日向坂46 コラボリスニングパーティー DAY1', place: 'Ohisama' },
  { date: '2025/01/03', time: '22:30', name: '櫻坂46 × 日向坂46 コラボリスニングパーティー DAY2', place: 'Buddies' },
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
            <tr><th>日付</th><th>時間</th><th>名前</th><th>場所</th></tr>
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
    tbody.append(row);
  }
}

mountTab();
mountView();

export { EVENTS };
