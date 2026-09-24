const SUMMARY_MODES = new Set(['daily', 'weekly', 'monthly']);
const HISTORY_MODES = new Set([...SUMMARY_MODES, 'ranking', 'broadcasts']);
const SUMMARY_REMOVED_LABELS = new Set(['最大いいね', '主なホスト', '有効記録数', '同接有効数']);
const RANKING_REMOVED_LABELS = new Set(['前週順位', '前週比', 'ランキング種別', '順位データ出典', '品質', 'データ品質']);
const RENAMED_LABELS = new Map([
  ['記録数', ['取得記録数', 'その期間に保存された全サンプル数']],
  ['メンバー（開始）', ['メンバー数（開始）', '期間開始時点のメンバー数']],
  ['メンバー（終了）', ['メンバー数（終了）', '期間終了時点のメンバー数']],
  ['メンバー増加', ['メンバー増加数', '期間内のメンバー数の増加']],
  ['曲数', ['楽曲数', '期間内に確認された楽曲数']],
]);
const CACHE_MIGRATION_KEY = 'sh.history.display-cleanup.v6';
const HISTORY_CACHE_PREFIX = 'sh.history.v3:';
const MOBILE_TABLE_STYLE_ID = 'compact-mobile-table-widths';
const rankingMetadataByRow = new Map();
const rankingMetadataByHost = new Map();
let cleaning = false;

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase();
}

function formatRankingMetadata(row) {
  const artist = String(row?.artist_name || '').trim();
  return {
    channel: String(row?.stationhead_channel_name || '').trim() || '—',
    artist: artist || '—',
    relation: artist ? (row?.fandom_type === 'official' ? '公式' : 'ファンダム') : '—',
  };
}

function rankingRowKey(week, host) {
  return `${String(week || '').trim()}\u0000${normalizeHost(host)}`;
}

function captureRankingMetadata(payload) {
  rankingMetadataByRow.clear();
  rankingMetadataByHost.clear();
  if (!payload || payload.mode !== 'ranking' || !Array.isArray(payload.rows)) return;
  for (const row of payload.rows) {
    const host = normalizeHost(row?.host_name);
    if (!host) continue;
    const metadata = formatRankingMetadata(row);
    rankingMetadataByRow.set(rankingRowKey(row?.ranking_date, host), metadata);
    if (metadata.artist !== '—' || metadata.channel !== '—') rankingMetadataByHost.set(host, metadata);
  }
}

function installMobileTableWidthStyle() {
  if (document.getElementById(MOBILE_TABLE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = MOBILE_TABLE_STYLE_ID;
  style.textContent = `
    @media (max-width: 760px) {
      #historyView .table-wrap table.compact-columns,
      #likesView .table-wrap table {
        width: 100% !important;
        min-width: 100% !important;
        table-layout: fixed !important;
      }

      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) th:nth-child(1),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) td:nth-child(1) { width: 22% !important; }
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) th:nth-child(2),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) td:nth-child(2) { width: 19% !important; }
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) th:nth-child(3),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) td:nth-child(3) { width: 17% !important; }
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) th:nth-child(4),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) td:nth-child(4) { width: 20% !important; }
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) th:nth-child(5),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) td:nth-child(5) { width: 12% !important; }
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) th:nth-child(6),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) td:nth-child(6) { width: 10% !important; }

      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) th:nth-child(2),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) td:nth-child(2),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) th:nth-child(3),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) td:nth-child(3),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) th:nth-child(4),
      #historyView .table-wrap table.compact-columns:not(.all-host-ranking-table) td:nth-child(4) {
        overflow-wrap: anywhere;
      }

      #likesView .table-wrap th:nth-child(1),
      #likesView .table-wrap td:nth-child(1) { width: 10% !important; }
      #likesView .table-wrap th:nth-child(2),
      #likesView .table-wrap td:nth-child(2) { width: 32% !important; }
      #likesView .table-wrap th:nth-child(3),
      #likesView .table-wrap td:nth-child(3) { width: 23% !important; }
      #likesView .table-wrap th:nth-child(4),
      #likesView .table-wrap td:nth-child(4) { width: 15% !important; }
      #likesView .table-wrap th:nth-child(5),
      #likesView .table-wrap td:nth-child(5) { width: 20% !important; }

      #likesView .table-wrap th:nth-child(2),
      #likesView .table-wrap td:nth-child(2),
      #likesView .table-wrap th:nth-child(3),
      #likesView .table-wrap td:nth-child(3),
      #likesView .table-wrap th:nth-child(5),
      #likesView .table-wrap td:nth-child(5) {
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }
    }
  `;
  document.head.append(style);
}

function clearStaleHistoryCache() {
  try {
    if (sessionStorage.getItem(CACHE_MIGRATION_KEY) === '1') return;
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(HISTORY_CACHE_PREFIX)) sessionStorage.removeItem(key);
    }
    sessionStorage.setItem(CACHE_MIGRATION_KEY, '1');
  } catch {}
}

function activeMode() {
  return String(document.querySelector('#modeTabs button.active[data-mode]')?.dataset?.mode || '');
}

function removedLabels(mode) {
  if (SUMMARY_MODES.has(mode)) return SUMMARY_REMOVED_LABELS;
  if (mode === 'ranking') return RANKING_REMOVED_LABELS;
  return null;
}

function syncTableModeClasses(table, mode) {
  if (!table) return;
  table.classList.toggle('compact-columns', mode === 'ranking');
  table.classList.toggle('official-party-table', mode === 'broadcasts');
  if (mode !== 'ranking') table.classList.remove('all-host-ranking-table');
}

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value);
}

function resetSharedHistorySummary(mode) {
  if (!HISTORY_MODES.has(mode)) return;
  setText('periodLabel', mode === 'ranking' ? '総週数' : '期間数');
  setText('maxLabel', mode === 'ranking' ? 'ランクイン週数' : '平均同接');
  setText('streamLabel', mode === 'ranking' ? '圏外・欠測週数' : mode === 'broadcasts' ? '最大同接' : '再生数増加');
  setText('memberLabel', mode === 'ranking' ? '対象ホスト' : mode === 'broadcasts' ? '平均所要時間' : 'メンバー増加数');
  for (const id of ['periods', 'maxListener', 'streamGrowth', 'memberGrowth']) setText(id, '—');
  const notice = document.getElementById('notice');
  if (notice) {
    notice.textContent = '';
    notice.classList.remove('error');
  }
  const more = document.getElementById('more');
  if (more) more.hidden = true;
}

function resetHistoryTable(mode) {
  if (!HISTORY_MODES.has(mode)) return;
  const head = document.getElementById('thead');
  const body = document.getElementById('tbody');
  if (!head || !body) return;
  const table = head.closest('table');
  table?.classList.remove('all-host-ranking-table');
  syncTableModeClasses(table, mode);
  head.replaceChildren();
  body.replaceChildren();
  resetSharedHistorySummary(mode);
}

function prepareTableForModeTransition(event) {
  const button = event?.target?.closest?.('button[data-mode]');
  if (!button) return;
  resetHistoryTable(String(button.dataset.mode || ''));
}

function ensureRankingMetadataColumns(head, body) {
  const headers = [...head.querySelectorAll('th')];
  const labels = new Set(headers.map((cell) => cell.textContent.trim()));
  if (labels.has('チャンネル') && labels.has('アーティスト名') && labels.has('種別')) return;
  const hostIndex = headers.findIndex((cell) => cell.textContent.trim() === 'ホスト');
  if (hostIndex < 0) return;

  const channelHeader = document.createElement('th');
  channelHeader.scope = 'col';
  channelHeader.textContent = 'チャンネル';
  const artistHeader = document.createElement('th');
  artistHeader.scope = 'col';
  artistHeader.textContent = 'アーティスト名';
  const relationHeader = document.createElement('th');
  relationHeader.scope = 'col';
  relationHeader.textContent = '種別';
  headers[hostIndex].after(channelHeader, artistHeader, relationHeader);

  for (const row of body.querySelectorAll('tr')) {
    const cells = [...row.querySelectorAll('td')];
    if (cells.length === 1 && cells[0].colSpan > 1) {
      cells[0].colSpan += 3;
      continue;
    }
    const hostCell = cells[hostIndex];
    if (!hostCell) continue;
    const week = cells[0]?.textContent?.trim() || '';
    const host = hostCell.textContent.trim();
    const metadata = rankingMetadataByRow.get(rankingRowKey(week, host))
      || rankingMetadataByHost.get(normalizeHost(host))
      || { channel: '—', artist: '—', relation: '—' };
    const channelCell = document.createElement('td');
    channelCell.className = 'ranking-channel-cell';
    channelCell.textContent = metadata.channel;
    const artistCell = document.createElement('td');
    artistCell.className = 'ranking-artist-cell';
    artistCell.textContent = metadata.artist;
    const relationCell = document.createElement('td');
    relationCell.className = 'ranking-relation-cell';
    relationCell.textContent = metadata.relation;
    hostCell.after(channelCell, artistCell, relationCell);
  }
}

function cleanTable() {
  const mode = activeMode();
  const removedSet = removedLabels(mode);
  const head = document.getElementById('thead');
  const body = document.getElementById('tbody');
  if (!head || !body) return;

  syncTableModeClasses(head.closest('table'), mode);
  if (cleaning || !removedSet) return;

  const headers = [...head.querySelectorAll('th')];
  if (SUMMARY_MODES.has(mode)) {
    for (const cell of headers) {
      const replacement = RENAMED_LABELS.get(cell.textContent.trim());
      if (!replacement) continue;
      cell.textContent = replacement[0];
      cell.title = replacement[1];
    }
  }
  const removed = headers
    .map((cell, index) => removedSet.has(cell.textContent.trim()) ? index : -1)
    .filter((index) => index >= 0)
    .sort((a, b) => b - a);
  cleaning = true;
  try {
    for (const index of removed) {
      head.querySelectorAll('th')[index]?.remove();
      for (const row of body.querySelectorAll('tr')) {
        const cells = row.querySelectorAll('td');
        if (cells.length === 1 && cells[0].colSpan > 1) {
          cells[0].colSpan = Math.max(1, cells[0].colSpan - 1);
        } else {
          cells[index]?.remove();
        }
      }
    }
    if (mode === 'ranking') ensureRankingMetadataColumns(head, body);
  } finally {
    cleaning = false;
  }
}

function scheduleCleanup() {
  queueMicrotask(cleanTable);
}

installMobileTableWidthStyle();
clearStaleHistoryCache();
window.addEventListener('history:data-loaded', (event) => {
  captureRankingMetadata(event?.detail?.data);
  scheduleCleanup();
});
window.addEventListener('history:runtime-ready', scheduleCleanup);
window.addEventListener('hashchange', scheduleCleanup);
document.getElementById('modeTabs')?.addEventListener('click', (event) => {
  prepareTableForModeTransition(event);
  scheduleCleanup();
});
document.getElementById('rankingScope')?.addEventListener('change', () => resetHistoryTable('ranking'));
document.getElementById('more')?.addEventListener('click', scheduleCleanup);
scheduleCleanup();
