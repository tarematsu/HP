const stylesheetHref = '/dashboard-fixes.css';
if (!document.querySelector(`link[href="${stylesheetHref}"]`)) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = stylesheetHref;
  document.head.append(stylesheet);
}

const description = document.getElementById('description');
const updated = document.getElementById('updated');
if (updated) {
  updated.className = 'subtle';
  if (description) description.replaceWith(updated);
}
description?.remove();

document.querySelector('.live-line')?.remove();
document.querySelector('.app-launch')?.remove();

const actions = document.querySelector('.dashboard-actions');
const tabs = document.getElementById('modeTabs');
if (actions && tabs) actions.replaceWith(tabs);
