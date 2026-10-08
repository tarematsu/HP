export const CHART_RANGE_OPTIONS = Object.freeze([
  { value: '1m', label: '1ヶ月', days: 31 },
  { value: '6m', label: '半年', days: 183 },
  { value: '1y', label: '1年', days: 366 },
  { value: 'all', label: '全期間', days: null },
]);

function dateValue(value) {
  const text = String(value || '').slice(0, 10);
  const time = Date.parse(`${text}T00:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

export function filterDatesByRange(dates = [], range = '1y') {
  const values = [...dates].filter(Boolean);
  const option = CHART_RANGE_OPTIONS.find((item) => item.value === range) || CHART_RANGE_OPTIONS[2];
  if (!option.days || !values.length) return values;
  const maximum = Math.max(...values.map(dateValue).filter((value) => value != null));
  if (!Number.isFinite(maximum)) return values;
  const minimum = maximum - (option.days - 1) * 86_400_000;
  return values.filter((value) => (dateValue(value) ?? maximum) >= minimum);
}

export function ensureChartRangeControls(container, {
  owner = '',
  value = '1y',
  onChange,
} = {}) {
  if (!container) return null;
  const key = String(owner || container.id || 'chart');
  let controls = container.parentElement?.querySelector(`.chart-range-controls[data-range-owner="${CSS.escape(key)}"]`);
  if (!controls) {
    controls = document.createElement('div');
    controls.className = 'chart-range-controls';
    controls.dataset.rangeOwner = key;
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'グラフ表示期間');
    container.before(controls);
  }
  controls.replaceChildren();
  for (const option of CHART_RANGE_OPTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.range = option.value;
    button.textContent = option.label;
    const active = option.value === value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
    button.addEventListener('click', () => onChange?.(option.value));
    controls.append(button);
  }
  return controls;
}
