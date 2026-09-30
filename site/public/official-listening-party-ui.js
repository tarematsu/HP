export const OFFICIAL_PARTY_HEADERS = Object.freeze([
  '日付', '時間帯', '所要時間', '平均同接', '最小同接', '最大同接',
  '楽曲数', '推定再生数', '放送内容', 'イベント名', '出典',
]);

const DATE_PREFIX = /^\s*(\d{4})[./-](\d{1,2})[./-](\d{1,2})\s*/;

export function officialPartyNumberText(value, formatter, fallback = '—') {
  if (value === null || value === undefined || value === '') return String(fallback);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !formatter?.format) return String(fallback);
  return formatter.format(parsed);
}

export function durationLabel(minutes, fallback = '—') {
  if (minutes === null || minutes === undefined || minutes === '') return String(fallback);
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0) return String(fallback);
  const rounded = Math.round(value);
  if (rounded < 60) return `${rounded}分`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest ? `${hours}時間${rest}分` : `${hours}時間`;
}

export function splitOfficialEventName(eventName, {
  defaultName = '公式リスパ',
  fallbackDate = '—',
} = {}) {
  const raw = String(eventName || defaultName).trim();
  const match = DATE_PREFIX.exec(raw);
  if (!match) return { date: String(fallbackDate), name: raw || defaultName };
  return {
    date: `${match[1]}/${String(Number(match[2])).padStart(2, '0')}/${String(Number(match[3])).padStart(2, '0')}`,
    name: raw.slice(match[0].length).trim() || defaultName,
  };
}

export function createOfficialPartyHeaderRow({ layoutMarker = false } = {}) {
  const row = document.createElement('tr');
  if (layoutMarker) row.dataset.officialPartyLayout = '1';
  for (const label of OFFICIAL_PARTY_HEADERS) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    row.append(cell);
  }
  return row;
}

export function createOfficialSourceCell(sourceUrl, label = '公式告知') {
  const cell = document.createElement('td');
  const source = String(sourceUrl || '').trim();
  if (!source) {
    cell.textContent = '—';
    return cell;
  }
  const link = document.createElement('a');
  link.href = source;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  cell.append(link);
  return cell;
}

export function createOfficialPartyDataRow(values = [], sourceUrl) {
  const row = document.createElement('tr');
  for (const value of Array.isArray(values) ? values : []) {
    const cell = document.createElement('td');
    cell.textContent = String(value ?? '—');
    row.append(cell);
  }
  row.append(createOfficialSourceCell(sourceUrl));
  return row;
}
