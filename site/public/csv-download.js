export function csvCell(value, { quoteAll = true } = {}) {
  const text = String(value ?? '');
  const escaped = text.replaceAll('"', '""');
  return quoteAll || /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
}

export function csvText(rows = [], {
  bom = true,
  quoteAll = true,
  trailingNewline = false,
} = {}) {
  const lines = (Array.isArray(rows) ? rows : []).map((row) => (
    (Array.isArray(row) ? row : [row])
      .map((value) => csvCell(value, { quoteAll }))
      .join(',')
  ));
  const body = lines.join('\n');
  return `${bom ? '\uFEFF' : ''}${body}${trailingNewline && body ? '\n' : ''}`;
}

export function downloadCsv(filename, rows, options = {}) {
  const blob = new Blob([csvText(rows, options)], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = String(filename || 'download.csv');
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 0);
}
