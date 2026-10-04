import { safeInteger as integer } from './dashboard-ui-common.js?v=20261004.1';
import {
  MUSIC_ARTIST_LABELS,
  loadMusicServiceReadModel,
} from './music-service-runtime-common.js?v=20261004.2';

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
const MUSIC_SERVICES = Object.freeze([
  ['youtube_music', 'YouTube Music'],
  ['kkbox', 'KKBOX'],
  ['qq_music', 'QQ音乐'],
  ['kugou_music', '酷狗音乐'],
]);
const cachedPayloads = new Map();

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

function artistName(row) {
  const key = String(row?.canonical_artist || '').trim();
  return String(row?.display_name || MUSIC_ARTIST_LABELS[key] || key || '-').trim();
}

function streamingAccount(service, serviceLabel, row, index) {
  const value = nonNegative(row?.followers);
  if (value == null) return null;
  const group = normalizedId(row?.canonical_artist);
  const id = `${service}:${group || normalizedId(row?.service_artist_id) || index}`;
  return {
    id,
    label: artistName(row),
    affiliation: serviceLabel,
    group,
    value,
    day_delta: null,
    week_delta: null,
    color: GROUP_COLORS[group] || '#6f7886',
    dash: [],
    date: validDate(row?.snapshot_date) ? row.snapshot_date : '',
  };
}

export async function loadStreamingFollowers() {
  const settled = await Promise.allSettled(MUSIC_SERVICES.map(async ([service, label]) => ({
    service,
    label,
    payload: await loadMusicServiceReadModel(service),
  })));
  const successful = settled.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  if (!successful.length) throw new Error('music streaming follower read models unavailable');
  const accounts = successful.flatMap(({ service, label, payload }) =>
    (Array.isArray(payload?.artists) ? payload.artists : [])
      .map((row, index) => streamingAccount(service, label, row, index))
      .filter(Boolean));
  const dates = [...new Set(accounts.map((account) => account.date).filter(validDate))].sort();
  const rows = dates.map((date) => ({
    date,
    values: Object.fromEntries(accounts
      .filter((account) => account.date === date && account.value != null)
      .map((account) => [account.id, account.value])),
  })).filter((row) => Object.keys(row.values).length);
  const updatedAt = Math.max(0, ...successful.flatMap(({ payload }) => [
    timestamp(payload?.updated_at) || 0,
    timestamp(payload?.source_updated_at) || 0,
    ...(Array.isArray(payload?.artists) ? payload.artists.map((artist) => timestamp(artist?.observed_at) || 0) : []),
  ]));
  const failed = settled.length - successful.length;
  const noFollowerMetric = successful.length && !accounts.length;
  return {
    source: 'music-streaming',
    updated_at: updatedAt || null,
    cadence: 'サービスごとの更新周期',
    metric_label: 'フォロワー数',
    chart_title: '音楽ストリーミングサービス フォロワー推移',
    table_title: '音楽ストリーミングサービス フォロワー比較',
    columns: ['アーティスト', 'サービス', 'フォロワー数', '前日比', '1週間前比'],
    accounts: accounts.sort((a, b) => a.affiliation.localeCompare(b.affiliation, 'ja')
      || a.label.localeCompare(b.label, 'ja')),
    rows,
    notice: failed
      ? `${failed}サービスのリードモデルを取得できませんでした。取得できたサービスのみ表示しています。`
      : noFollowerMetric
        ? '現在の対応サービスのリードモデルにはフォロワー数がありません。'
        : '',
    chart_enabled: rows.length > 1,
  };
}

async function stationheadPayload({ force = false } = {}) {
  const key = 'followers:stationhead';
  if (force) cachedPayloads.delete(key);
  if (!cachedPayloads.has(key)) {
    const promise = fetch('/api/followers', {
      headers: { accept: 'application/json' },
      cache: force ? 'reload' : 'default',
    }).then(async (response) => {
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || `followers HTTP ${response.status}`);
      return normalizeStationheadFollowers(payload);
    }).catch((error) => {
      cachedPayloads.delete(key);
      throw error;
    });
    cachedPayloads.set(key, promise);
  }
  return cachedPayloads.get(key);
}

async function streamingPayload({ force = false } = {}) {
  const key = 'followers:music-streaming';
  if (force) cachedPayloads.delete(key);
  if (!cachedPayloads.has(key)) {
    const promise = loadStreamingFollowers().catch((error) => {
      cachedPayloads.delete(key);
      throw error;
    });
    cachedPayloads.set(key, promise);
  }
  return cachedPayloads.get(key);
}

const MODELS = Object.freeze({
  stationhead: () => ({ source: 'stationhead', load: stationheadPayload }),
  'music-streaming': () => ({ source: 'music-streaming', load: streamingPayload }),
});
const instances = new Map();

export function followersReadModel(source = 'stationhead') {
  const key = Object.hasOwn(MODELS, source) ? source : 'stationhead';
  if (!instances.has(key)) instances.set(key, MODELS[key]());
  return instances.get(key);
}
