export const SVG_NS = 'http://www.w3.org/2000/svg';
export const integerFormat = new Intl.NumberFormat('ja-JP');
export const decimalOneFormat = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });

export function byId(id) {
  return document.getElementById(id);
}

export function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function safeInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function setText(id, value) {
  const node = byId(id);
  const text = String(value);
  if (node && node.textContent !== text) node.textContent = text;
}

export function setNotice(id, message = '', error = false) {
  const node = byId(id);
  if (!node) return;
  const text = String(message || '');
  if (node.textContent !== text) node.textContent = text;
  node.hidden = !text;
  node.classList.toggle('error', Boolean(error));
}

export function cssColor(name, fallback) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function svgElement(name, attributes = {}, text = null) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  if (text != null) node.textContent = String(text);
  return node;
}

export function isoDateParts(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function shortDate(value, fallback = '-') {
  const parts = isoDateParts(value);
  return parts ? `${parts[1]}/${parts[2]}` : String(fallback);
}

export function fullDate(value, fallback = '-') {
  const parts = isoDateParts(value);
  return parts ? `${parts[0]}/${parts[1]}/${parts[2]}` : String(fallback);
}

function joinClasses(...values) {
  return values.flat().filter(Boolean).join(' ');
}

function hiddenAttribute(hidden) {
  return hidden ? ' hidden' : '';
}

export function dashboardMetric({ label = '', valueId = '', value = '-', className = '', extraHtml = '' } = {}) {
  return `<article class="${joinClasses('metric', className)}"><span>${label}</span><div class="metric-value"><strong${valueId ? ` id="${valueId}"` : ''}>${value}</strong></div>${extraHtml}</article>`;
}

export function dashboardMetrics(items = [], { className = '', ariaLabel = '' } = {}) {
  return `<section class="${joinClasses('metrics', className)}"${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}>${items.join('')}</section>`;
}

export function dashboardSummaryItem({ label = '', labelId = '', valueId = '', value = '-', className = '', valueClassName = '' } = {}) {
  return `<article${className ? ` class="${className}"` : ''}><span${labelId ? ` id="${labelId}"` : ''}>${label}</span><strong${valueId ? ` id="${valueId}"` : ''}${valueClassName ? ` class="${valueClassName}"` : ''}>${value}</strong></article>`;
}

export function dashboardSummary(items = [], { id = '', className = '', ariaLabel = '' } = {}) {
  return `<section${id ? ` id="${id}"` : ''} class="${joinClasses('summary-cards', className)}"${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}>${items.join('')}</section>`;
}

export function dashboardSectionHead({ kicker = '', title = '', titleId = '', trailingHtml = '', className = '' } = {}) {
  const headingHtml = kicker || title
    ? `<div>${kicker ? `<p class="kicker">${kicker}</p>` : ''}${title ? `<h2${titleId ? ` id="${titleId}"` : ''}>${title}</h2>` : ''}</div>`
    : '';
  return `<div class="${joinClasses('section-head', className)}">${headingHtml}${trailingHtml}</div>`;
}

export function dashboardLegend({ id = '', items = [], ariaLabel = 'グラフ凡例', className = '' } = {}) {
  return `<div${id ? ` id="${id}"` : ''} class="${joinClasses('legend', className)}" aria-label="${ariaLabel}">${items.join('')}</div>`;
}

export function dashboardChartCard({
  id = '',
  title = '',
  titleId = '',
  kicker = '',
  trailingHtml = '',
  legendHtml = '',
  chartHtml = '',
  detailHtml = '',
  footerHtml = '',
  className = '',
  ariaLabelledBy = '',
  hidden = false,
} = {}) {
  const labelledBy = ariaLabelledBy || titleId;
  return `<section${id ? ` id="${id}"` : ''} class="${joinClasses('card', 'chart-panel', className)}"${labelledBy ? ` aria-labelledby="${labelledBy}"` : ''}${hiddenAttribute(hidden)}>${dashboardSectionHead({ kicker, title, titleId, trailingHtml, className: 'chart-head' })}${legendHtml}${chartHtml}${detailHtml}${footerHtml}</section>`;
}

export function dashboardTable({
  id = '',
  className = '',
  colgroupHtml = '',
  headHtml = '',
  bodyId = '',
  bodyHtml = '',
  wrapClassName = '',
} = {}) {
  return `<div class="${joinClasses('table-wrap', wrapClassName)}"><table${id ? ` id="${id}"` : ''} class="${joinClasses('shared-numeric-table', className)}">${colgroupHtml}${headHtml}<tbody${bodyId ? ` id="${bodyId}"` : ''}>${bodyHtml}</tbody></table></div>`;
}

export function dashboardDataCard({
  id = '',
  title = '',
  titleId = '',
  kicker = '',
  trailingHtml = '',
  bodyHtml = '',
  className = '',
  ariaLabelledBy = '',
  hidden = false,
} = {}) {
  const labelledBy = ariaLabelledBy || titleId;
  return `<section${id ? ` id="${id}"` : ''} class="${joinClasses('card', 'data-panel', className)}"${labelledBy ? ` aria-labelledby="${labelledBy}"` : ''}${hiddenAttribute(hidden)}>${dashboardSectionHead({ kicker, title, titleId, trailingHtml })}${bodyHtml}</section>`;
}

export function dashboardControls({ id = '', bodyHtml = '', className = '', ariaLabel = '', hidden = false } = {}) {
  return `<section${id ? ` id="${id}"` : ''} class="${joinClasses('controls', 'card', className)}"${ariaLabel ? ` aria-label="${ariaLabel}"` : ''}${hiddenAttribute(hidden)}>${bodyHtml}</section>`;
}

function firstMatch(root, selectors) {
  for (const selector of selectors || []) {
    const node = selector ? root?.querySelector(selector) : null;
    if (node) return node;
  }
  return null;
}

export function mountDashboardTab({
  view,
  mode = '',
  label,
  active = false,
  anchorSelector = '',
  anchorSelectors = [],
  position = 'beforebegin',
  tabsId = 'modeTabs',
} = {}) {
  const tabs = byId(tabsId);
  if (!tabs || !view) return null;
  const selector = mode
    ? `[data-view="${CSS.escape(view)}"][data-mode="${CSS.escape(mode)}"]`
    : `[data-view="${CSS.escape(view)}"]:not([data-mode])`;
  const existing = tabs.querySelector(selector);
  if (existing) return existing;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = view;
  if (mode) button.dataset.mode = mode;
  button.textContent = String(label || mode || view);
  if (active) {
    button.classList.add('active');
    button.setAttribute('aria-current', 'page');
  }
  const selectors = anchorSelectors.length ? anchorSelectors : [anchorSelector];
  const anchor = firstMatch(tabs, selectors);
  if (anchor) anchor.insertAdjacentElement(position, button);
  else tabs.append(button);
  return button;
}

export function mountDashboardView({
  id,
  className = '',
  html = '',
  hidden = true,
  anchorId = '',
  anchorIds = [],
  position = 'beforebegin',
  contentId = 'content',
} = {}) {
  const main = byId(contentId);
  if (!main || !id) return null;
  const existing = byId(id);
  if (existing) return existing;
  const section = document.createElement('section');
  section.id = id;
  section.className = ['dashboard-view', className].filter(Boolean).join(' ');
  section.hidden = Boolean(hidden);
  section.innerHTML = html;
  const ids = anchorIds.length ? anchorIds : [anchorId];
  const anchor = ids.map((item) => item && byId(item)).find(Boolean) || null;
  if (anchor) anchor.insertAdjacentElement(position, section);
  else main.append(section);
  return section;
}

export function mountDashboardShell({ tab, view } = {}) {
  return {
    tab: tab ? mountDashboardTab(tab) : null,
    view: view ? mountDashboardView(view) : null,
  };
}
