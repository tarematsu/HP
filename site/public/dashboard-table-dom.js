function tableRow(cells, header = false) {
  const row = document.createElement('tr');
  for (const value of cells || []) {
    const cell = document.createElement(header ? 'th' : 'td');
    if (header) cell.scope = 'col';
    if (value?.className) cell.className = value.className;
    if (value?.colSpan) cell.colSpan = value.colSpan;
    if (value?.node?.nodeType) cell.append(value.node);
    else cell.textContent = String(value?.text ?? value ?? '');
    row.append(cell);
  }
  return row;
}

export function appendTableRow(container, cells = [], { className = '' } = {}) {
  if (!container) return null;
  const row = tableRow(cells);
  if (className) row.className = className;
  container.append(row);
  return row;
}

export function replaceTableHeader(container, headers = []) {
  if (!container) return null;
  const row = tableRow(headers, true);
  container.replaceChildren(row);
  return row;
}

// One renderer owns the desktop table and its matching narrow-screen card list.
// Pages supply only a column schema and their row values; no view repeats DOM layout.
export function renderResponsiveTable({ head, body, cards, columns = [], rows = [],
  valuesForRow, emptyMessage = 'データがありません。' } = {}) {
  if (!head || !body || typeof valuesForRow !== 'function') return;
  const header = tableRow(columns.map((column) => ({ text: column.label || column.key || '' })), true);
  header.querySelectorAll('th').forEach((cell, index) => {
    if (columns[index]?.numeric) cell.className = 'dashboard-number';
  });
  head.replaceChildren(header);
  const tableFragment = document.createDocumentFragment();
  const cardFragment = document.createDocumentFragment();
  for (const row of rows) {
    const cells = valuesForRow(row);
    tableFragment.append(tableRow(cells));
    if (!cards) continue;
    const card = document.createElement('article');
    card.className = 'dashboard-responsive-card';
    for (let index = 0; index < columns.length; index += 1) {
      const column = columns[index] || {};
      const raw = cells[index];
      const field = document.createElement('div');
      field.className = 'dashboard-responsive-field';
      field.dataset.key = String(column.key || index);
      if (raw?.className) field.classList.add(...String(raw.className).split(/\\s+/).filter(Boolean));
      const label = document.createElement('span');
      label.className = 'dashboard-responsive-label';
      label.textContent = String(column.label || column.key || '');
      const value = document.createElement('span');
      value.className = 'dashboard-responsive-value';
      if (raw?.node?.nodeType) value.append(raw.node.cloneNode(true));
      else value.textContent = String(raw?.text ?? raw ?? '');
      field.append(label, value);
      card.append(field);
    }
    cardFragment.append(card);
  }
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = Math.max(1, columns.length);
    td.textContent = emptyMessage;
    tr.append(td);
    tableFragment.append(tr);
    if (cards) {
      const empty = document.createElement('p');
      empty.className = 'shared-empty';
      empty.textContent = emptyMessage;
      cardFragment.append(empty);
    }
  }
  body.replaceChildren(tableFragment);
  cards?.replaceChildren(cardFragment);
}
