import { byId, setNotice } from './dashboard-ui-common.js?v=20261001.1';

const boundFilters = new WeakSet();

export function regionalProviderDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

export function regionalProviderDateText(value, fallback = '-') {
  const date = regionalProviderDate(value);
  return date ? date.replaceAll('-', '/') : fallback;
}

// Filter state remains owned by each service. Only DOM sync and event binding
// are shared, so service-specific chart/history selection remains independent.
export function createRegionalFilters(definitions, onChange) {
  const filters = definitions.map(({ attribute, get, set }) => ({
    attribute: String(attribute),
    get,
    set,
  }));
  function sync() {
    for (const { attribute, get } of filters) {
      for (const button of document.querySelectorAll(`[data-${attribute}]`)) {
        const active = button.getAttribute(`data-${attribute}`) === get();
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }
    }
  }
  function bind() {
    for (const { attribute, get, set } of filters) {
      for (const button of document.querySelectorAll(`[data-${attribute}]`)) {
        if (boundFilters.has(button)) continue;
        boundFilters.add(button);
        button.addEventListener('click', () => {
          const next = button.getAttribute(`data-${attribute}`) || '';
          if (!next || next === get()) return;
          set(next);
          sync();
          onChange?.();
        });
      }
    }
  }
  return { bind, sync };
}

export function renderRegionalServiceStatus(payload, { service, noticeId, label }) {
  const state = (Array.isArray(payload?.services) ? payload.services : [])
    .find((item) => item.service === service);
  if (state?.status === 'error') {
    setNotice(noticeId, `${label}の収集でエラーが発生しています。直前までの正常データを表示しています。`, true);
  } else if (state?.status === 'degraded') {
    setNotice(noticeId, `${label}の一部項目の取得に失敗しています。取得できたデータのみ表示しています。`);
  } else {
    setNotice(noticeId);
  }
}

// Same plot geometry and missing-rank presentation for QQ/Kugou/KKBOX.
// The series, dates, labels and filtering logic are provider-specific.
export function regionalRankChartOptions({
  containerId, legendId, series, dates, ariaLabel, emptyText, dateLabel,
}) {
  return {
    container: byId(containerId),
    legendContainer: byId(legendId),
    series,
    dates,
    height: 320,
    margin: { left: 58, right: 18, top: 12, bottom: 34 },
    yMax: 101,
    rankTicks: [1, 25, 50, 75, 101],
    dateTickCount: 5,
    ariaLabel,
    lineClass: 'kugou-rank-line',
    emptyClass: 'music-service-rank-empty',
    emptyText,
    rankLabel: (rank) => rank === 101 ? '圏外' : `${rank}位`,
    dateLabel,
    latestPoint: { radius: () => 2.5 },
  };
}
