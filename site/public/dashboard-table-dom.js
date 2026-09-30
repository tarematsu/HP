function cellSpec(value, defaultTagName) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value, tagName: value.tagName || defaultTagName };
  }
  return { text: value, tagName: defaultTagName };
}

function createCell(value, defaultTagName = 'td') {
  const spec = cellSpec(value, defaultTagName);
  const tagName = spec.tagName === 'th' ? 'th' : 'td';
  const cell = document.createElement(tagName);
  if (spec.className) cell.className = String(spec.className);
  if (spec.scope && tagName === 'th') cell.scope = String(spec.scope);
  if (spec.title) cell.title = String(spec.title);
  if (spec.colSpan != null) cell.colSpan = Math.max(1, Number(spec.colSpan) || 1);
  if (spec.node?.nodeType) cell.append(spec.node);
  else cell.textContent = String(spec.text ?? spec.value ?? '');
  return cell;
}

export function createTableRow(cells = [], {
  className = '',
  cellTagName = 'td',
  dataset = null,
} = {}) {
  const row = document.createElement('tr');
  if (className) row.className = String(className);
  if (dataset && typeof dataset === 'object') {
    for (const [key, value] of Object.entries(dataset)) {
      if (value != null) row.dataset[key] = String(value);
    }
  }
  for (const value of cells) row.append(createCell(value, cellTagName));
  return row;
}

export function createTableHeaderRow(headers = [], options = {}) {
  return createTableRow(headers.map((header) => {
    if (header && typeof header === 'object' && !Array.isArray(header)) {
      return { ...header, tagName: 'th', scope: header.scope || 'col' };
    }
    return { text: header, tagName: 'th', scope: 'col' };
  }), options);
}

export function appendTableRow(container, cells = [], options = {}) {
  if (!container) return null;
  const row = createTableRow(cells, options);
  container.append(row);
  return row;
}
