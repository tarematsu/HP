function seriesId(item, index) {
  return String(item?.id ?? item?.name ?? index);
}

export function renderSeriesSelector({
  optionsContainer,
  legendContainer,
  items = [],
  hidden = new Set(),
  onChange,
  legendLimit = 3,
} = {}) {
  if (optionsContainer) {
    optionsContainer.replaceChildren();
    items.forEach((item, index) => {
      const id = seriesId(item, index);
      const label = document.createElement('label');
      label.className = 'series-selector-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !hidden.has(id);
      input.dataset.seriesId = id;
      const marker = document.createElement('i');
      marker.style.background = item.color || '#111';
      const text = document.createElement('span');
      text.textContent = item.label || item.name || id;
      label.append(input, marker, text);
      input.addEventListener('change', () => {
        if (input.checked) hidden.delete(id);
        else hidden.add(id);
        onChange?.(hidden);
      });
      optionsContainer.append(label);
    });
  }
  if (legendContainer) {
    legendContainer.replaceChildren();
    const visible = items.filter((item, index) => !hidden.has(seriesId(item, index)));
    visible.slice(0, legendLimit).forEach((item, index) => {
      if (index) legendContainer.append(' / ');
      const span = document.createElement('span');
      span.textContent = item.label || item.name || seriesId(item, index);
      span.style.color = item.color || '#111';
      legendContainer.append(span);
    });
    if (visible.length > legendLimit) legendContainer.append(` / 他${visible.length - legendLimit}件`);
  }
}

export function visibleSeries(items = [], hidden = new Set()) {
  return items.filter((item, index) => !hidden.has(seriesId(item, index)));
}
