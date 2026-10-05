import { loadDashboardJson } from './dashboard-data-client.js?v=20261005.2';
import { safeInteger as integer } from './dashboard-ui-common.js?v=20261004.1';

const STATIONHEAD_HANDLES = Object.freeze([
  'sakuramankai',
  'sakuramankai2',
  'sakurazaka46jp',
  'nogizaka46smej',
]);
const STATIONHEAD_MEMBERSHIPS = Object.freeze({
  sakuramankai: Object.freeze({ affiliation: 'Buddies', group: 'sakurazaka46' }),
  sakuramankai2: Object.freeze({ affiliation: 'Buddies', group: 'sakurazaka46' }),
  sakurazaka46jp: Object.freeze({ affiliation: '櫻坂46公式', group: 'sakurazaka46' }),
  nogizaka46smej: Object.freeze({ affiliation: '乃木坂46公式', group: 'nogizaka46' }),
});
const GROUP_COLORS = Object.freeze({
  sakurazaka46: '#f3a6c8',
  nogizaka46: '#8264b0',
  hinatazaka46: '#9ecff3',
});
const FAN_DASHES = Object.freeze([[10, 6], [2, 5], [14, 4, 3, 4]]);

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function nonNegative(value) {
  const parsed = integer(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function normalizedId(value) {
  return String(value || '').trim().toLowerCase();
}

function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function offsetDate(value, days) {
  if (!validDate(value)) return '';
  const time = Date.parse(`${value}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

function stationheadMembership(payload, row, handle) {
  const fallback = STATIONHEAD_MEMBERSHIPS[handle] || {};
  const supplied = payload?.memberships?.[handle] || {};
  return {
    affiliation: String(supplied?.affiliation || supplied?.label || row?.affiliation || fallback.affiliation || '-').trim() || '-',
    group: normalizedId(supplied?.group || row?.group || fallback.group),
  };
}

function stationheadRows(payload, ids) {
  const byDate = new Map();
  for (const row of Array.isArray(payload?.rows) ? payload.rows : []) {
    if (!validDate(row?.date)) continue;
    const values = {};
    for (const id of ids) {
      const value = nonNegative(row?.[id]);
      if (value != null) values[id] = value;
    }
    if (Object.keys(values).length) byDate.set(row.date, { date: row.date, values });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function normalizeStationheadFollowers(payload = {}) {
  const ids = [...new Set([
    ...STATIONHEAD_HANDLES,
    ...(Array.isArray(payload?.handles) ? payload.handles : []),
    ...(Array.isArray(payload?.accounts) ? payload.accounts.map((row) => row?.handle) : []),
  ].map(normalizedId).filter(Boolean))].sort((a, b) => {
    const ai = STATIONHEAD_HANDLES.indexOf(a);
    const bi = STATIONHEAD_HANDLES.indexOf(b);
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    return a.localeCompare(b);
  });
  const rows = stationheadRows(payload, ids);
  const latest = rows.at(-1);
  const byDate = new Map(rows.map((row) => [row.date, row]));
  const previous = latest ? byDate.get(offsetDate(latest.date, -1)) : null;
  const week = latest ? byDate.get(offsetDate(latest.date, -7)) : null;
  const provided = new Map((Array.isArray(payload?.accounts) ? payload.accounts : [])
    .map((row) => [normalizedId(row?.handle), row])
    .filter(([id]) => id));
  const accounts = ids.map((id, index) => {
    const row = provided.get(id) || {};
    const membership = stationheadMembership(payload, row, id);
    const value = nonNegative(row?.followers ?? latest?.values?.[id]);
    const dayValue = nonNegative(previous?.values?.[id]);
    const weekValue = nonNegative(week?.values?.[id]);
    const official = membership.affiliation.endsWith('公式');
    return {
      id,
      label: id,
      affiliation: membership.affiliation,
      group: membership.group,
      value,
      day_delta: integer(row?.previous_day_delta)
        ?? (value != null && dayValue != null ? value - dayValue : null),
      week_delta: integer(row?.previous_week_delta)
        ?? (value != null && weekValue != null ? value - weekValue : null),
      color: GROUP_COLORS[membership.group] || '#6f7886',
      dash: official ? [] : FAN_DASHES[index % FAN_DASHES.length],
    };
  });
  return {
    source: 'stationhead',
    updated_at: timestamp(payload?.updated_at),
    cadence: '毎日00:00',
    metric_label: 'フォロワー数',
    chart_title: 'フォロワー数推移',
    table_title: '最新フォロワー比較',
    columns: ['アカウント名', '所属', 'フォロワー数', '前日比', '1週間前比'],
    accounts,
    rows,
    notice: rows.length ? '' : 'フォロワー履歴はまだありません。初回の0時収集後に表示されます。',
    chart_enabled: rows.length > 1,
  };
}

async function stationheadPayload({ force = false } = {}) {
  return normalizeStationheadFollowers(await loadDashboardJson('/api/followers', { force }));
}

const model = { source: 'stationhead', load: stationheadPayload };
export function followersReadModel() {
  return model;
}
