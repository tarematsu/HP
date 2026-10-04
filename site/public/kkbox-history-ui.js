import {
  appendEmptyTableRow,
  byId,
  integerFormat,
} from './dashboard-ui-common.js?v=20261001.1';
import { appendTableRow } from './dashboard-table-dom.js?v=20261001.1';
import {
  MUSIC_ARTIST_LABELS,
  loadRegionalMusicReadModel,
  replaceMusicTableBody,
} from './music-service-runtime-common.js?v=20261004.1';

const SERVICE = 'kkbox';
const SECTION_ID = 'kkboxJapaneseHistorySection';
const BODY_ID = 'kkboxJapaneseHistoryBody';
const ARTIST_LABELS = Object.freeze({
  ...MUSIC_ARTIST_LABELS,
  keyakizaka46: '欅坂46',
  hiragana_keyakizaka46: 'けやき坂46',
});
const TERRITORY_LABELS = Object.freeze({ tw: '台湾', hk: '香港' });
const PERIOD_LABELS = Object.freeze({ daily: '日次', weekly: '週次' });
const CHART_LABELS = Object.freeze({ song: '楽曲', newrelease: '新曲' });

let activeRequest = 0;

function dateText(value) {
  const text = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text.replaceAll('-', '/') : '-';
}

function artistText(item) {
  const artists = Array.isArray(item?.canonical_artists) ? item.canonical_artists : [];
  if (artists.length) return artists.map((artist) => ARTIST_LABELS[artist] || artist).join(' / ');
  return item?.artist_name || '-';
}

export function renderKkboxHistory(payload) {
  const body = replaceMusicTableBody(BODY_ID);
  if (!body) return;
  const history = Array.isArray(payload?.kkbox_japanese_chart?.history)
    ? payload.kkbox_japanese_chart.history
    : [];
  const ordered = [...history].sort((a, b) =>
    String(b?.period || '').localeCompare(String(a?.period || ''))
      || Number(a?.rank || Infinity) - Number(b?.rank || Infinity)
      || String(a?.title || '').localeCompare(String(b?.title || '')));
  if (!ordered.length) {
    appendEmptyTableRow(body, 'KKBOX 日語チャートのランクイン履歴はありません。', 7);
    return;
  }
  for (const item of ordered) {
    const rank = Number(item?.rank);
    appendTableRow(body, [
      dateText(item?.period),
      TERRITORY_LABELS[item?.territory] || item?.territory || '-',
      PERIOD_LABELS[item?.period_type] || item?.period_type || '-',
      CHART_LABELS[item?.chart_type] || item?.chart_type || '-',
      artistText(item),
      Number.isFinite(rank) && rank > 0 ? `${integerFormat.format(rank)}位` : '-',
      item?.title || '-',
    ]);
  }
}

async function syncKkboxHistory() {
  const request = ++activeRequest;
  const section = byId(SECTION_ID);
  if (!section) return;
  const visible = location.hash.slice(1) === SERVICE;
  section.hidden = !visible;
  if (!visible) return;
  replaceMusicTableBody(BODY_ID);
  try {
    const payload = await loadRegionalMusicReadModel(SERVICE);
    if (request === activeRequest && location.hash.slice(1) === SERVICE) renderKkboxHistory(payload);
  } catch {
    if (request !== activeRequest || location.hash.slice(1) !== SERVICE) return;
    const body = replaceMusicTableBody(BODY_ID);
    if (body) appendEmptyTableRow(body, 'KKBOX履歴データを取得できませんでした。', 7);
  }
}

export function initKkboxHistoryUi() {
  window.addEventListener('hashchange', () => void syncKkboxHistory());
  void syncKkboxHistory();
}
