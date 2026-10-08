function enabledButtons(container) {
  return [...(container?.querySelectorAll('button:not(:disabled)') || [])].filter((button) => !button.hidden);
}

export function syncRovingTabs(container, activeButton = null) {
  const buttons = enabledButtons(container);
  const selected = activeButton || buttons.find((button) => button.classList.contains('active')) || buttons[0] || null;
  for (const button of buttons) {
    const active = button === selected;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  if (container) container.setAttribute('role', 'tablist');
}

export function bindRovingTabs(container, activate) {
  if (!container || container.dataset.rovingTabsBound === '1') return;
  container.dataset.rovingTabsBound = '1';
  syncRovingTabs(container);
  container.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const buttons = enabledButtons(container);
    if (!buttons.length) return;
    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = buttons.length - 1;
    else if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % buttons.length;
    else nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    event.preventDefault();
    const next = buttons[nextIndex];
    next.focus();
    if (typeof activate === 'function') activate(next);
    else next.click();
  });
}
