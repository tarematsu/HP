function tableRow(cells, header = false) {
  const row = document.createElement('tr');
  for (const value of cells || []) {
    const cell = document.createElement(header ? 'th' : 'td');
    if (header) cell.scope = 'col';
    if (value?.node?.nodeType) cell.append(value.node);
    else cell.textContent = String(value?.text ?? value ?? '');
    row.append(cell);
  }
  return row;
}

export function appendTableRow(container, cells = []) {
  if (!container) return null;
  const row = tableRow(cells);
  container.append(row);
  return row;
}

export function replaceTableHeader(container, headers = []) {
  if (!container) return null;
  const row = tableRow(headers, true);
  container.replaceChildren(row);
  return row;
}
