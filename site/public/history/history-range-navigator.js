(() => {
  'use strict';

  const DAY_MS = 86_400_000;
  const EARLIEST_DATE = '2024-05-01';
  const PERIODS = Object.freeze([
    { key: 'month', label: '1ヶ月', months: 1 },
    { key: 'half-year', label: '半年', months: 6 },
    { key: 'year', label: '1年', months: 12 },
    { key: 'all', label: '全期間', months: null },
  ]);

  const rangePresets = document.getElementById('rangePresets');
  const fromInput = document.getElementById('from');
  const toInput = document.getElementById('to');
  const chart = document.getElementById('chart');
  if (!rangePresets || !fromInput || !toInput || !chart) return;

  let activePeriod = 'all';

  function ensureStylesheet() {
    if (document.querySelector('link[data-history-range-navigator]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/history/history-range-navigator.css?v=20260925.1';
    link.dataset.historyRangeNavigator = '1';
    document.head.append(link);
  }

  function todayUtc() {
    return new Date().toISOString().slice(0, 10);
  }

  function parseIso(value) {
    const date = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function toIso(date) {
    return date.toISOString().slice(0, 10);
  }

  function shiftMonths(value, months) {
    const date = parseIso(value);
    if (!date) return value;
    const day = date.getUTCDate();
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    target.setUTCDate(Math.min(day, lastDay));
    return toIso(target);
  }

  function setInputs(from, to) {
    fromInput.value = from;
    toInput.value = to;
    syncArrowState();
  }

  function currentRange() {
    const from = parseIso(fromInput.value);
    const to = parseIso(toInput.value);
    if (!from || !to || from > to) return null;
    return { from, to };
  }

  function requestReload() {
    const loadButton = document.getElementById('load');
    if (!loadButton) return;
    loadButton.dispatchEvent(new Event('click', { bubbles: true }));
  }

  function setActivePeriod(periodKey) {
    activePeriod = periodKey;
    rangePresets.querySelectorAll('button[data-history-period]').forEach((button) => {
      const active = button.dataset.historyPeriod === periodKey;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    syncArrowState();
  }

  function applyLatestPeriod(periodKey) {
    const period = PERIODS.find((item) => item.key === periodKey) || PERIODS.at(-1);
    const to = todayUtc();
    const from = period.key === 'all' ? EARLIEST_DATE : shiftMonths(to, -period.months);
    setInputs(from, to);
    setActivePeriod(period.key);
    requestReload();
  }

  function shiftVisibleRange(direction) {
    if (activePeriod === 'all') return;
    const range = currentRange();
    if (!range) return;

    const spanDays = Math.max(1, Math.round((range.to - range.from) / DAY_MS));
    const stepDays = Math.max(1, Math.floor(spanDays / 2));
    const earliest = parseIso(EARLIEST_DATE);
    const latest = parseIso(todayUtc());
    let nextFrom = new Date(range.from.getTime() + direction * stepDays * DAY_MS);
    let nextTo = new Date(range.to.getTime() + direction * stepDays * DAY_MS);

    if (nextFrom < earliest) {
      nextFrom = earliest;
      nextTo = new Date(earliest.getTime() + spanDays * DAY_MS);
    }
    if (nextTo > latest) {
      nextTo = latest;
      nextFrom = new Date(latest.getTime() - spanDays * DAY_MS);
    }

    setInputs(toIso(nextFrom), toIso(nextTo));
    requestReload();
  }

  function syncArrowState() {
    const previous = document.getElementById('historyRangePrevious');
    const next = document.getElementById('historyRangeNext');
    if (!previous || !next) return;

    const summaryMode = ['daily', 'weekly', 'monthly'].includes(location.hash.slice(1) || 'weekly');
    const navigable = summaryMode && activePeriod !== 'all';
    previous.hidden = !navigable;
    next.hidden = !navigable;
    if (!navigable) return;

    const range = currentRange();
    if (!range) return;
    previous.disabled = toIso(range.from) <= EARLIEST_DATE;
    next.disabled = toIso(range.to) >= todayUtc();
  }

  function mountNavigator() {
    if (document.getElementById('historyChartNavigator')) return;
    const wrapper = document.createElement('div');
    wrapper.id = 'historyChartNavigator';
    wrapper.className = 'history-chart-navigator';

    const previous = document.createElement('button');
    previous.id = 'historyRangePrevious';
    previous.className = 'history-range-arrow';
    previous.type = 'button';
    previous.setAttribute('aria-label', '表示期間を前へ移動');
    previous.textContent = '‹';

    const next = document.createElement('button');
    next.id = 'historyRangeNext';
    next.className = 'history-range-arrow';
    next.type = 'button';
    next.setAttribute('aria-label', '表示期間を後ろへ移動');
    next.textContent = '›';

    chart.before(wrapper);
    wrapper.append(previous, chart, next);
    previous.addEventListener('click', () => shiftVisibleRange(-1));
    next.addEventListener('click', () => shiftVisibleRange(1));
  }

  function simplifyRangeControls() {
    rangePresets.setAttribute('aria-label', '表示期間');
    const buttons = [...rangePresets.querySelectorAll('button')];
    PERIODS.forEach((period, index) => {
      const button = buttons[index];
      if (!button) return;
      button.textContent = period.label;
      button.dataset.historyPeriod = period.key;
      button.setAttribute('aria-pressed', period.key === 'all' ? 'true' : 'false');
    });

    const dateRange = document.querySelector('.date-range');
    if (dateRange) {
      dateRange.hidden = true;
      dateRange.setAttribute('aria-hidden', 'true');
    }

    const loadButton = document.getElementById('load');
    if (loadButton) {
      loadButton.hidden = true;
      loadButton.setAttribute('aria-hidden', 'true');
      loadButton.tabIndex = -1;
    }
  }

  ensureStylesheet();
  simplifyRangeControls();
  mountNavigator();
  setActivePeriod('all');

  rangePresets.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-history-period]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    applyLatestPeriod(button.dataset.historyPeriod);
  }, true);

  window.addEventListener('history:data-loaded', syncArrowState);
  window.addEventListener('hashchange', syncArrowState);
  document.querySelectorAll('#modeTabs button').forEach((button) =>
    button.addEventListener('click', () => queueMicrotask(syncArrowState)));
})();
