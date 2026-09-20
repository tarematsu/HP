const stylesheetHref = '/dashboard-fixes.css?v=20260919.3';
if (!document.querySelector(`link[href="${stylesheetHref}"]`)) {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = stylesheetHref;
  document.head.append(stylesheet);
}

const monochromeStylesheetHref = '/monochrome.css?v=20260919.3';
if (!document.querySelector(`link[href="${monochromeStylesheetHref}"]`)) {
  const monochromeStylesheet = document.createElement('link');
  monochromeStylesheet.rel = 'stylesheet';
  monochromeStylesheet.href = monochromeStylesheetHref;
  document.head.append(monochromeStylesheet);
}

const KEYBOARD_NAVIGATION_CLASS = 'keyboard-navigation';
const skipLink = document.querySelector('.skip-link');
const clearKeyboardNavigation = () => {
  document.documentElement.classList.remove(KEYBOARD_NAVIGATION_CLASS);
};
const releaseProgrammaticSkipLinkFocus = () => {
  if (
    document.activeElement === skipLink
    && !document.documentElement.classList.contains(KEYBOARD_NAVIGATION_CLASS)
  ) skipLink?.blur();
};
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !event.isTrusted) return;
  document.documentElement.classList.add(KEYBOARD_NAVIGATION_CLASS);
  setTimeout(() => {
    if (document.activeElement !== skipLink) clearKeyboardNavigation();
  }, 0);
}, { capture: true });
skipLink?.addEventListener('focus', releaseProgrammaticSkipLinkFocus);
queueMicrotask(releaseProgrammaticSkipLinkFocus);
document.addEventListener('focusout', (event) => {
  if (event.target === skipLink) clearKeyboardNavigation();
}, { capture: true });
document.addEventListener('pointerdown', clearKeyboardNavigation, { capture: true });

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