function applyHistoryTerminology() {
  const historyView = document.getElementById('historyView');
  if (!historyView) return;
  for (const header of historyView.querySelectorAll('th')) {
    if (header.textContent.trim() === '品質') header.textContent = 'データ品質';
  }
}

window.addEventListener('history:data-loaded', applyHistoryTerminology);
window.addEventListener('history:runtime-ready', applyHistoryTerminology);
