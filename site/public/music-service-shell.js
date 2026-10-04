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
} = {}) {
  const heading = dashboardSectionHead({
    kicker,
    title,
    titleId,
    trailingHtml,
    className: 'music-service-section-head',
  });
  return `<section${id ? ` id="${id}"` : ''} class="${joinClasses('music-service-section', className)}"${hidden ? ' hidden' : ''}>
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
}
