import {
  dashboardModeTabs,
  dashboardNotice,
  dashboardSectionHead,
  dashboardTable,
  dashboardUpdateMeta,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261004.1';
import { bindRovingTabs, syncRovingTabs } from './dashboard-roving-tabs.js';

function joinClasses(...values) {
  return values.flat().filter(Boolean).join(' ');
}

function joinHtml(values) {
  return values.flat(Infinity).filter(Boolean).join('');
}

export function musicServiceViewClassName(...classes) {
  return joinClasses('is-chart-compact', 'music-service-view', classes);
}

export function musicServiceMeta(options = {}) {
  return dashboardUpdateMeta({ ...options,
    className: joinClasses('music-service-meta', options.className),
  });
}

export function musicServiceNotice(id) {
  return id ? dashboardNotice({ id }) : '';
}

export function musicServiceFilterTabs(items, {
  className = '',
  role = 'group',
  selection = 'pressed',
  ...options
} = {}) {
  return dashboardModeTabs(items, {
    ...options,
    className: joinClasses('music-service-filter', className),
    role,
    selection,
  });
}

export function musicServiceTable({
  kind = 'track',
  className = '',
  ...options
} = {}) {
  return dashboardTable({
    ...options,
    className: joinClasses('music-service-table', `music-service-${kind}-table`, className),
  });
}

const SAKAMICHI_FILTER_ITEMS = Object.freeze([
  { value: 'all', label: 'すべて', active: true },
  { value: 'sakurazaka46', label: '櫻坂' },
  { value: 'nogizaka46', label: '乃木坂' },
  { value: 'hinatazaka46', label: '日向坂' },
]);

export function musicServiceSakamichiFilter({ dataAttribute, ariaLabel }) {
  return musicServiceFilterTabs(SAKAMICHI_FILTER_ITEMS, { dataAttribute, ariaLabel });
}

export function musicServiceRankingHistoryTable(bodyId, dateLabel = '更新日') {
  return musicServiceTable({
    className: 'music-service-history-table',
    wrapClassName: 'music-service-table-wrap',
    headers: [dateLabel, 'グループ', '順位', '曲名'],
    bodyId,
  });
}

export function musicServiceRankChart({ legendId, chartId }) {
  return `<div id="${legendId}" class="music-service-rank-legend" aria-label="グループ凡例"></div>
    <div id="${chartId}" class="music-service-rank-chart"></div>`;
}

// A regional chart and its companion history table always have one layout.
// Provider differences are IDs, titles and optional extra chart filters.
export function musicServiceRegionalChartPair({
  chartSectionId, historySectionId, chartTitle, historyTitle,
  chartId, legendId, historyBodyId, filterAttribute, filterAriaLabel,
  dateLabel = '更新日', leadingChartHtml = '', group = 'ranks',
}) {
  return [
    musicServiceSection({
      id: chartSectionId,
      group,
      title: chartTitle,
      bodyHtml: leadingChartHtml + musicServiceRankChart({ legendId, chartId }),
    }),
    musicServiceSection({
      id: historySectionId,
      group,
      title: historyTitle,
      trailingHtml: musicServiceSakamichiFilter({
        dataAttribute: filterAttribute,
        ariaLabel: filterAriaLabel,
      }),
      bodyHtml: musicServiceRankingHistoryTable(historyBodyId, dateLabel),
    }),
  ];
}

export function musicServiceSection({
  id = '',
  title = '',
  titleId = '',
  kicker = '',
  trailingHtml = '',
  bodyHtml = '',
  className = '',
  hidden = false,
  group = 'overview',
} = {}) {
  const heading = dashboardSectionHead({
    kicker,
    title,
    titleId,
    trailingHtml,
    className: 'music-service-section-head',
  });
  return `<section${id ? ` id="${id}"` : ''} class="${joinClasses('music-service-section', className)}" data-service-group="${group}"${hidden ? ' hidden' : ''}>
    ${heading}
    ${bodyHtml}
  </section>`;
}

export function mountMusicServiceView({
  viewId,
  className = '',
  noticeId = '',
  meta = null,
  sections = [],
  groupLabels = {},
  beforeSectionsHtml = '',
  afterSectionsHtml = '',
  anchorId = 'likesView',
  position = 'beforebegin',
} = {}) {
  if (!viewId) throw new Error('music service viewId is required');
  mountDashboardShell({
    view: {
      id: viewId,
      className: musicServiceViewClassName(className),
      anchorId,
      position,
      html: joinHtml([
        meta ? musicServiceMeta(meta) : '',
        musicServiceNotice(noticeId),
        beforeSectionsHtml,
        sections,
        afterSectionsHtml,
      ]),
    },
  });
  const root = document.getElementById(viewId);
  if (root) bindServiceGroups(root, groupLabels);
}

export function bindServiceGroups(root, labels = {}) {
  const sections = [...root.querySelectorAll('[data-service-group]')];
  const present = [...new Set(sections.map((section) => section.dataset.serviceGroup))];
  const groups = [...Object.keys(labels).filter(group => present.includes(group)), ...present.filter(group => !(group in labels))];
  if (groups.length < 2) return;
  const nav = document.createElement('div');
  nav.className = 'mode-tabs music-service-view-tabs';
  nav.setAttribute('aria-label', '表示内容');
  // Group visibility must not overwrite runtime-owned empty/filter visibility.
  const panels = groups.map((group) => {
    const panel = document.createElement('div');
    panel.className = 'music-service-group';
    panel.dataset.group = group;
    const children = sections.filter(section => section.dataset.serviceGroup === group);
    children[0].before(panel);
    panel.append(...children);
    return panel;
  });
  let active = groups[0];
  function select(group) {
    active = group;
    root.dataset.activeServiceGroup = group;
    for (const panel of panels) panel.hidden = panel.dataset.group !== group;
    for (const button of nav.querySelectorAll('button')) {
      const selected = button.dataset.serviceGroup === group;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    syncRovingTabs(nav);
    const selected = nav.querySelector('button.active');
    if (selected && nav.clientWidth > 0 && nav.scrollWidth > nav.clientWidth) {
      const bounds = nav.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (item.left < bounds.left) nav.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right) nav.scrollLeft += item.right - bounds.right;
    }
    root.dispatchEvent(new CustomEvent('music-service:group-change', { detail: { group } }));
    window.dispatchEvent(new Event('resize'));
  }
  for (const group of groups) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.serviceGroup = group;
    button.textContent = labels[group] || group;
    button.addEventListener('click', () => select(group));
    nav.append(button);
  }
  const meta = root.querySelector('.music-service-meta');
  if (meta) meta.after(nav); else root.prepend(nav);
  select(active);
  bindRovingTabs(nav, button => select(button.dataset.serviceGroup));
}
