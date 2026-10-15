// Shared bounded-history control; only the selected page becomes table rows.
export function renderMusicServicePager(container, { total = 0, page = 1, pageSize = 80, onChange } = {}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.max(1, Math.min(page, pages));
  if (!container) return current;
  container.replaceChildren();
  container.hidden = pages <= 1;
  if (pages <= 1) return current;
  const button = (label, target, disabled) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.disabled = disabled;
    node.addEventListener('click', () => onChange?.(target));
    return node;
  };
  const description = document.createElement('span');
  description.className = 'shared-note';
  const start = (current - 1) * pageSize + 1;
  const end = Math.min(total, current * pageSize);
  description.textContent = `${start}–${end} / ${total}件（${current}/${pages}ページ）`;
  container.append(button('前へ', current - 1, current === 1), description,
    button('次へ', current + 1, current === pages));
  return current;
}
