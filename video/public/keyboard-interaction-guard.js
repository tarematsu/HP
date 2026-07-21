const PRESERVED_KEYS = new Set([
  ' ',
  'Enter',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End'
]);

export function preservesInteractiveKey(tagName, key, contentEditable = false) {
  const tag = String(tagName || '').toLowerCase();
  return PRESERVED_KEYS.has(String(key || ''))
    && (Boolean(contentEditable) || ['button', 'input', 'textarea', 'select'].includes(tag));
}

function initialize() {
  window.addEventListener('keydown', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const interactive = target.closest('button, input, textarea, select, [contenteditable="true"]');
    if (!interactive) return;
    if (!preservesInteractiveKey(
      interactive.tagName,
      event.key,
      interactive.matches('[contenteditable="true"]')
    )) return;

    event.stopImmediatePropagation();
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') initialize();
