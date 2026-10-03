import { dashboardSectionHead } from './dashboard-ui-common.js?v=20261001.1';

function joinClasses(...values) {
  return values.flat().filter(Boolean).join(' ');
}

export function musicServiceViewClassName(...classes) {
  return joinClasses('regional-music-view', 'is-chart-compact', 'music-service-view', classes);
}

export function musicServiceMeta({
  label = '更新日時',
  valueId = '',
  cadence = '-',
  cadenceId = '',
  id = '',
  className = '',
} = {}) {
  return `<div${id ? ` id="${id}"` : ''} class="${joinClasses('regional-chart-meta', 'music-service-meta', className)}">
    <span>${label} <strong${valueId ? ` id="${valueId}"` : ''}>-</strong></span>
    <span>更新周期 <strong${cadenceId ? ` id="${cadenceId}"` : ''}>${cadence || '-'}</strong></span>
  </div>`;
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
    className: 'regional-chart-section-head',
  });
  return `<section${id ? ` id="${id}"` : ''} class="${joinClasses('music-service-section', 'regional-chart-section', className)}"${hidden ? ' hidden' : ''}>
    ${heading}
    ${bodyHtml}
  </section>`;
}
