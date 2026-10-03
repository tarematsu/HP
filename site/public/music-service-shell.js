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
  const heading = title || kicker || trailingHtml
    ? `<div class="regional-chart-section-head"><div>${kicker ? `<p class="kicker">${kicker}</p>` : ''}${title ? `<h2${titleId ? ` id="${titleId}"` : ''}>${title}</h2>` : ''}</div>${trailingHtml}</div>`
    : '';
  return `<section${id ? ` id="${id}"` : ''} class="${joinClasses('music-service-section', 'regional-chart-section', className)}"${hidden ? ' hidden' : ''}>
    ${heading}
    ${bodyHtml}
  </section>`;
}
