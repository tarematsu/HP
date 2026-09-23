const DAY_MS = 86_400_000;
const integer = new Intl.NumberFormat('ja-JP');
const jstChartDateTime = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
let rows = [];

const finite = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};
const numberText = (value) => finite(value) == null ? '—' : integer.format(Number(value));

function normalizeHistory(history) {
  const list = Array.isArray(history) ? history : [];
  const latest = list.reduce((maximum, row) => Math.max(maximum, finite(row?.observed_at) || 0), 0);
  if (!latest) return [];
  const cutoff = latest - DAY_MS;
  const byTime = new Map();
  for (const row of list) {
    const observedAt = finite(row?.observed_at);
    if (observedAt == null || observedAt < cutoff || observedAt > latest) continue;
    byTime.set(observedAt, {
      observed_at: observedAt,
      online_member_count: finite(row.online_member_count),
    });
  }
  return [...byTime.values()].sort((a, b) => a.observed_at - b.observed_at);
}

function selectPoint(event) {
  if (!rows.length) return;
  const canvas = document.getElementById('audienceChart');
  const bounds = canvas?.getBoundingClientRect();
  if (!canvas || !bounds || bounds.width <= 0) return;
  const minTime = rows[0].observed_at;
  const maxTime = rows.at(-1).observed_at;
  const span = Math.max(1, maxTime - minTime);
  const padding = { left: 50, right: 24 };
  const plotWidth = Math.max(1, bounds.width - padding.left - padding.right);
  const pointer = event.clientX - bounds.left;
  let selected = 0;
  let distance = Infinity;
  rows.forEach((row, index) => {
    const x = padding.left + plotWidth * (row.observed_at - minTime) / span;
    const next = Math.abs(x - pointer);
    if (next < distance) {
      distance = next;
      selected = index;
    }
  });
  const row = rows[selected];
  const detail = document.getElementById('currentChartDetail');
  if (detail) {
    detail.textContent = `${jstChartDateTime.format(new Date(row.observed_at))} JST　オンライン数 ${numberText(row.online_member_count)}人`;
  }
}

window.addEventListener('dashboard:payload', (event) => {
  const payload = event?.detail?.payload;
  if (!payload?.ok) return;
  rows = normalizeHistory(payload.history);
});
document.getElementById('audienceChart')?.addEventListener('pointerup', selectPoint, true);
