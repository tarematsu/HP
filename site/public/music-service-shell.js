import {
  dashboardModeTabs,
  dashboardNotice,
  dashboardSectionHead,
  dashboardTable,
  mountDashboardShell,
} from './dashboard-ui-common.js?v=20261004.1';

function joinClasses(...values) {
  return values.flat().filter(Boolean).join(' ');
}

function joinHtml(values) {
  return values.flat(Infinity).filter(Boolean).join('');
}

export function musicServiceViewClassName(...classes) {
  return joinClasses('is-chart-compact', 'music-service-view', classes);
}

export function musicServiceMeta({
  label = '更新日時',
  valueId = '',
  cadence = '-',
  cadenceId = '',
  id = '',
  className = '',
} = {}) {
  return `<div${id ? ` id="${id}"` : ''} class="${joinClasses('music-service-meta', className)}">
    <span>${label} <strong${valueId ? ` id="${valueId}"` : ''}>-</strong></span>
    <span>更新周期 <strong${cadenceId ? ` id="${cadenceId}"` : ''}>${cadence || '-'}</strong></span>
  </div>`;
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
  if (root) bindServiceGroups(root);
}

function bindServiceGroups(root) {
  const sections = [...root.querySelectorAll('[data-service-group]')];
  const groups = [...new Set(sections.map((section) => section.dataset.serviceGroup))];
  if (groups.length < 2) return;
  const nav = document.createElement('div');
  nav.className = 'mode-tabs music-service-view-tabs';
  nav.setAttribute('aria-label', '表示内容');
  const labels = { overview: '概要', list: '一覧', playlists: 'プレイリスト' };
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
    for (const panel of panels) panel.hidden = panel.dataset.group !== group;
    for (const button of nav.querySelectorAll('button')) {
      const selected = button.dataset.serviceGroup === group;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
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
}
