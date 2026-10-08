// Request ownership and page metadata; table and chart own their presentation.
import { byId, setNotice as setSharedNotice } from './dashboard-ui-common.js?v=20261004.1';
import { leaderboardReadModel } from './leaderboard-read-model.js?v=20261005.1';
import { formatUpdatedAt } from './leaderboard/format.js';
import { renderTable } from './leaderboard/table.js';
import { createLeaderboardChart } from './leaderboard/chart.js';

const { renderChart, setChartEmpty, bindInteractions, resetSelection } = createLeaderboardChart();
let currentSource = '';
let requestSequence = 0;

function render(payload) {
  const updated = byId('leaderboardUpdatedAt');
  const cadence = byId('leaderboardCadence');
  const chartTitle = byId('leaderboardChartTitle');
  const chartFoot = byId('leaderboardChartFoot');
  const tableTitle = byId('leaderboardTableTitle');
  if (updated) updated.textContent = formatUpdatedAt(payload?.updated_at);
  if (cadence) cadence.textContent = String(payload?.cadence || '-');
  if (chartTitle) chartTitle.textContent = String(payload?.chart_title || 'リーダーボード順位推移');
  if (chartFoot) chartFoot.textContent = String(payload?.chart_foot || '');
  if (tableTitle) tableTitle.textContent = String(payload?.table_title || 'リーダーボード');
  setSharedNotice('leaderboardNotice', String(payload?.notice || ''), false);
  renderChart(payload);
  renderTable(payload);
}

export async function loadLeaderboardView({ source = 'stationhead', force = false } = {}) {
  const sequence = ++requestSequence;
  currentSource = source;
  bindInteractions();
  try {
    const payload = await leaderboardReadModel(source).load({ force });
    if (sequence !== requestSequence || currentSource !== source) return payload;
    resetSelection();
    render(payload);
    return payload;
  } catch (error) {
    if (sequence === requestSequence && currentSource === source) {
      setSharedNotice('leaderboardNotice', 'リーダーボードデータの取得に失敗しました。', true);
      setChartEmpty(true);
      renderTable({ columns: [], rows: [] });
    }
    throw error;
  }
}
