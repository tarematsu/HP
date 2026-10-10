// Channel lifecycle: selection, requests, stale results and visible-view refresh.
import { ensureDashboardSectionStyles } from './dashboard-styles.js?v=20261005.2';
import { bindRovingTabs, syncRovingTabs } from './dashboard-roving-tabs.js';
import { stationheadChannelReadModel } from './stationhead-channel-read-model.js?v=20261005.3';
import { role, setNotice } from './stationhead/view-utils.js';
import { renderCurrentDetail } from './stationhead/current-chart.js';
import { renderCurrent, renderPlayback } from './stationhead/playback.js';
import { renderDaily, exportHistoryCsv } from './stationhead/history-view.js';
import { loadPlayed } from './stationhead/played-tracks.js';
import { renderLikes, exportLikesCsv } from './stationhead/likes.js';
import { renderBroadcasts } from './stationhead/broadcasts.js';

const runtimes = new WeakMap();
async function loadSection(runtime, section, { force = false } = {}) {
  if (!runtime.model.capabilities.includes(section)) return;
  const sequence = ++runtime.requestSequence; const current = () => sequence === runtime.requestSequence && runtime.section === section && !runtime.root.hidden; setNotice(runtime.root, '');
  try {
    if (section === 'played-tracks') { await loadPlayed(runtime, { force }); return; }
    const methods = { current: 'loadCurrent', history: 'loadHistory', likes: 'loadLikes', broadcasts: 'loadBroadcasts' }; const payload = await runtime.model[methods[section]]({ force }); if (!current()) return;
    const renderers = { current: renderCurrent, history: renderDaily, likes: renderLikes, broadcasts: renderBroadcasts }; if (section === 'history') { runtime.historyPayload = payload; refreshHistoryRange(runtime); } else renderers[section](runtime, payload);
  } catch (error) { if (!current()) return; console.error(error); setNotice(runtime.root, `データの取得に失敗しました：${error.message}`, true); }
}

async function selectSection(runtime, section, { force = false, load = true } = {}) {
  if (!runtime.model.capabilities.includes(section)) return;
  const sequence = ++runtime.selectionSequence; runtime.section = section;
  if (section !== 'current') { try { await ensureDashboardSectionStyles('stationhead'); } catch { if (sequence === runtime.selectionSequence) setNotice(runtime.root, '表示スタイルの取得に失敗しました。再読み込みしてください。', true); return; } if (sequence !== runtime.selectionSequence) return; }
  runtime.root.querySelectorAll('[data-stationhead-section]').forEach((button) => { const active = button.dataset.stationheadSection === section; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  syncRovingTabs(runtime.root.querySelector('.stationhead-subtabs'), runtime.root.querySelector(`[data-stationhead-section="${section}"]`));
  runtime.root.querySelectorAll('[data-stationhead-panel]').forEach((panel) => { panel.hidden = panel.dataset.stationheadPanel !== section; });
  if (load) void loadSection(runtime, section, { force }); requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
}

function refreshHistoryRange(runtime) {
  if (!runtime.historyPayload) return;
  const available = Array.isArray(runtime.historyPayload.daily) ? runtime.historyPayload.daily : [];
  const isAll = runtime.historyRange === 'all';
  const firstDate = Date.parse(`${available[0]?.period_key}T00:00:00Z`);
  const lastDate = Date.parse(`${available.at(-1)?.period_key}T00:00:00Z`);
  const days = Number(runtime.historyRange) || 0;
  const step = Math.max(1, Math.floor(days / 2));
  const maxOffset = !isAll && Number.isFinite(firstDate) && Number.isFinite(lastDate)
    ? Math.max(0, Math.floor((lastDate - firstDate) / (step * 86_400_000))) : 0;
  runtime.historyOffset = Math.min(runtime.historyOffset, maxOffset);
  const previous = runtime.root.querySelector('[data-history-move="previous"]');
  const next = runtime.root.querySelector('[data-history-move="next"]');
  if (previous) previous.disabled = isAll || runtime.historyOffset >= maxOffset;
  if (next) next.disabled = isAll || runtime.historyOffset <= 0;
  renderDaily(runtime, runtime.historyPayload);
}

function initialize(root) {
  if (runtimes.has(root)) return runtimes.get(root);
  const model = stationheadChannelReadModel(root.dataset.stationheadModel || 'buddies');
  const initialHistoryRange = root.querySelector('[data-history-range].active')?.dataset.historyRange || 'all';
  const runtime = { root, model, section: '', selectionSequence: 0, requestSequence: 0, playedSequence: 0, historyRange: initialHistoryRange, historyOffset: 0, historyPayload: null, historyVisibleRows: [], current: null, playbackIndex: -1, playedDates: [], playedPeriod: '', likes: [], hiddenBroadcastSeries: new Set(), broadcastPayload: null };
  const capabilities = new Set(model.capabilities); const tabs = root.querySelector('.stationhead-subtabs');
  root.querySelectorAll('[data-stationhead-section]').forEach((button) => { const enabled = capabilities.has(button.dataset.stationheadSection); button.disabled = !enabled; button.setAttribute('aria-disabled', String(!enabled)); button.title = enabled ? '' : '未提供'; if (enabled) button.addEventListener('click', () => selectSection(runtime, button.dataset.stationheadSection)); });
  root.addEventListener('stationhead:history-mode', () => {
    if (runtime.section === 'history') void loadSection(runtime, 'history');
  });
  bindRovingTabs(tabs, (button) => button.click()); role(root, 'live-chart')?.addEventListener('pointerup', (event) => renderCurrentDetail(runtime, event), true); role(root, 'played-week')?.addEventListener('change', () => { runtime.playedPeriod = ''; void loadPlayed(runtime); });
  root.querySelectorAll('[data-history-range]').forEach((button) => button.addEventListener('click', () => {
    runtime.historyRange = button.dataset.historyRange;
    runtime.historyOffset = 0;
    root.querySelectorAll('[data-history-range]').forEach((item) => item.classList.toggle('active', item === button));
    refreshHistoryRange(runtime);
  }));
  root.querySelectorAll('[data-history-move]').forEach((button) => button.addEventListener('click', () => {
    const direction = button.dataset.historyMove === 'previous' ? 1 : -1;
    runtime.historyOffset = Math.max(0, runtime.historyOffset + direction);
    refreshHistoryRange(runtime);
  }));
  role(root, 'history-csv')?.addEventListener('click', () => exportHistoryCsv(runtime));
  role(root, 'likes-csv')?.addEventListener('click', () => exportLikesCsv(runtime));
  const initial = model.capabilities.includes('current') ? 'current' : model.capabilities[0]; runtimes.set(root, runtime); void selectSection(runtime, initial, { load: false }); return runtime;
}

export async function selectStationheadChannelSection(viewId, section, options = {}) {
  const root = typeof viewId === 'string' ? document.getElementById(viewId) : viewId; if (!root) return; const runtime = initialize(root); await selectSection(runtime, section, options);
}

export async function loadStationheadChannelView(viewId, { force = false } = {}) {
  const root = typeof viewId === 'string' ? document.getElementById(viewId) : viewId; if (!root) return; const runtime = initialize(root); if (root.hidden) return; await loadSection(runtime, runtime.section, { force });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) return; document.querySelectorAll('.stationhead-channel-view:not([hidden])').forEach((root) => { const runtime = initialize(root); void loadSection(runtime, runtime.section); }); });
function visibleCurrentRuntime() { if (document.hidden) return null; const root = document.querySelector('.stationhead-channel-view:not([hidden])'); const runtime = root && runtimes.get(root); return runtime?.section === 'current' ? runtime : null; }
setInterval(() => { const runtime = visibleCurrentRuntime(); if (runtime) void loadSection(runtime, 'current', { force: true }); }, 60_000);
setInterval(() => { const runtime = visibleCurrentRuntime(); if (runtime?.current) renderPlayback(runtime); }, 1_000);

