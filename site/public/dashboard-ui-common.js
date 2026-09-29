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
  if (node) node.textContent = String(value);
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

export function ensureStylesheet(href, key) {
  if (!href || !key) return null;
  const selector = `link[data-dashboard-feature-style="${CSS.escape(key)}"]`;
  const existing = document.querySelector(selector);
  if (existing) return existing;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.dashboardFeatureStyle = key;
  document.head.append(link);
  return link;
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
  label,
  anchorSelector = '',
  anchorSelectors = [],
  position = 'beforebegin',
  tabsId = 'modeTabs',
} = {}) {
  const tabs = byId(tabsId);
  if (!tabs || !view || tabs.querySelector(`[data-view="${CSS.escape(view)}"]`)) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.view = view;
  button.textContent = String(label || view);
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
  section.hidden = true;
  section.innerHTML = html;
  const ids = anchorIds.length ? anchorIds : [anchorId];
  const anchor = ids.map((item) => item && byId(item)).find(Boolean) || null;
  if (anchor) anchor.insertAdjacentElement(position, section);
  else main.append(section);
  return section;
}

export function mountDashboardShell({ style, tab, view } = {}) {
  ensureStylesheet('/dashboard-ui-common.css?v=20260930.1', 'dashboard-ui-common');
  if (style?.href && style?.key) ensureStylesheet(style.href, style.key);
  if (tab) mountDashboardTab(tab);
  if (view) mountDashboardView(view);
}
