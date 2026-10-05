import { byId as el, decimalOneFormat as decimal, finiteNumber as finite, setNotice as setSharedNotice, setText } from '../dashboard-ui-common.js?v=20260930.1';
import { downloadCsv } from '../csv-download.js?v=20261001.1';
import { createHistoryPayloadCache, historyCacheTtl, migrateHistoryCache } from './history-data-client.js';

import { createHistoryTable } from './history-table.js';
import { createHistorySummary } from './history-summary.js';

(() => {
  'use strict';

  const PAGE_SIZE = 200;
  const MODES = Object.freeze({
    daily: { title: '日次集計', table: '日次集計一覧', chart: '同接・再生数増加の推移' },
    weekly: { title: '週次集計', table: '週次集計一覧', chart: '同接・再生数増加の推移' },
    monthly: { title: '月次集計', table: '月次集計一覧', chart: '同接・再生数増加の推移' },
    broadcasts: { title: '公式リスパ比較', table: '公式リスパ一覧', chart: '公式リスパ 同接推移（開始0分比較）' },
  });

  const state = {
    mode: 'weekly',
    pastWeekMode: false,
    rows: [],
    tableRows: [],
    visibleRows: PAGE_SIZE,
    data: null,
    controller: null,
    requestToken: 0,
  };

  const numberText = (value) => finite(value) == null ? '—' : decimal.format(Number(value));
  const todayUtc = () => new Date().toISOString().slice(0, 10);
  const setNotice = (text, error = false) => setSharedNotice('notice', text, error);

  function dataMode() {
    return state.mode === 'daily' && state.pastWeekMode ? 'weekly' : state.mode;
  }

  migrateHistoryCache(sessionStorage);
  const fetchJson = createHistoryPayloadCache(sessionStorage);
  const { columnsFor, displayCell, renderTable } = createHistoryTable(state, dataMode, numberText, PAGE_SIZE);
  const { updateSummary } = createHistorySummary(state, dataMode, numberText);

  function shiftDate(value, days) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  }

  function applyPreset(days) {
    const to = todayUtc();
    const count = Math.max(1, Math.trunc(Number(days) || 30));
    const from = days === 'all' ? '2024-05-01' : shiftDate(to, -(count - 1));
    el('from').value = from;
    el('to').value = to;
    document.querySelectorAll('#rangePresets button').forEach((button) =>
      button.classList.toggle('active', button.dataset.days === String(days)));
  }

  function tableOrder(rows, mode) {
    return [...rows].reverse();
  }

  function updateModeUi() {
    const mode = dataMode();
    const config = MODES[mode];
    const toggle = el('historyPastWeekToggle');
    if (toggle) toggle.hidden = state.mode !== 'daily';
    const checkbox = el('historyPastWeekMode');
    if (checkbox) checkbox.checked = state.pastWeekMode;
    setText('guideTitle', config.title);
    setText('tableTitle', config.table);
    setText('chartTitle', config.chart);
    el('controls').hidden = state.mode === 'broadcasts';
    el('standardControls').hidden = false;
    setText('chartFoot', state.mode === 'broadcasts'
      ? '各線は1回の公式リスパです。横軸は各開催の開始からの経過時間です。'
      : '');
  }

  function resetData() {
    state.rows = [];
    state.tableRows = [];
    state.data = null;
    state.visibleRows = PAGE_SIZE;
    el('tbody').replaceChildren();
    el('chartLegend').replaceChildren();
  }

  function renderLoadedData() {
    updateSummary();
    state.tableRows = tableOrder(state.rows, dataMode());
    renderTable(true);
  }

  function publishHistoryData(mode, data, from, to, cached) {
    window.dispatchEvent(new CustomEvent('history:data-loaded', {
      detail: { mode, data, from, to, cached },
    }));
  }

  async function ensureModeRuntime(mode) {
    const ensure = window.__ensureHistoryModeRuntime;
    if (typeof ensure === 'function') await ensure(mode);
  }

  async function loadMode({ force = false } = {}) {
    const token = ++state.requestToken;
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    const routeMode = state.mode;
    const mode = dataMode();
    el('load').disabled = true;
    setNotice('');

    try {
      if (routeMode === 'broadcasts') {
        el('from').value = '2024-05-01';
        el('to').value = todayUtc();
      }
      const from = el('from').value;
      const to = el('to').value;
      const params = new URLSearchParams({ mode, from, to });
      const url = `/api/history?${params}`;
      const { data, cached } = await fetchJson(url, {
        ttl: historyCacheTtl(mode),
        signal: controller.signal,
        force,
      });
      if (token !== state.requestToken || state.mode !== routeMode || dataMode() !== mode) return;

      state.data = data;
      state.rows = Array.isArray(data.rows) ? data.rows : [];
      setNotice(`${numberText(state.rows.length)}件を表示 · UTC${cached ? ' · キャッシュ' : ''}`);
      renderLoadedData();
      publishHistoryData(mode, data, from, to, cached);
    } catch (error) {
      if (error?.name !== 'AbortError' && token === state.requestToken) {
        console.error(error);
        resetData();
        renderLoadedData();
        setNotice(`データの取得に失敗しました：${error.message}`, true);
      }
    } finally {
      if (token === state.requestToken) {
        state.controller = null;
        el('load').disabled = false;
      }
    }
  }

  async function setMode(mode) {
    if (!MODES[mode]) return;
    state.controller?.abort();
    const transitionToken = ++state.requestToken;
    state.mode = mode;
    resetData();
    updateModeUi();
    updateSummary();
    renderTable(true);
    history.replaceState(null, '', `#${mode}`);
    const runtimeMode = dataMode();
    try {
      await ensureModeRuntime(runtimeMode);
    } catch (error) {
      if (transitionToken === state.requestToken) {
        console.error('history mode runtime failed to load', error);
        setNotice('表示機能の読み込みに失敗しました。再読み込みしてください。', true);
      }
      return;
    }
    if (transitionToken !== state.requestToken || state.mode !== mode || dataMode() !== runtimeMode) return;
    void loadMode();
  }

  async function setPastWeekMode(enabled) {
    if (state.mode !== 'daily' || state.pastWeekMode === enabled) return;
    state.controller?.abort();
    const transitionToken = ++state.requestToken;
    state.pastWeekMode = enabled;
    resetData();
    updateModeUi();
    updateSummary();
    const mode = dataMode();
    try {
      await ensureModeRuntime(mode);
    } catch (error) {
      if (transitionToken === state.requestToken) {
        console.error('past history week runtime failed to load', error);
        setNotice('週表示の読み込みに失敗しました。', true);
      }
      return;
    }
    if (transitionToken !== state.requestToken || state.mode !== 'daily' || dataMode() !== mode) return;
    void loadMode();
  }

  function exportCsv() {
    const columns = columnsFor(dataMode());
    const rows = [
      columns.map(([, label]) => label),
      ...state.rows.map((row) => columns.map(([key]) => displayCell(key, row))),
    ];
    downloadCsv(`sh-${dataMode()}-${todayUtc()}.csv`, rows);
  }

  async function start() {
    el('to').value = todayUtc();
    applyPreset('all');
    document.querySelectorAll('#rangePresets button').forEach((button) =>
      button.addEventListener('click', () => {
        applyPreset(button.dataset.days);
        void loadMode();
      }));
    el('load').addEventListener('click', () => void loadMode({ force: true }));
    el('more').addEventListener('click', () => {
      state.visibleRows += PAGE_SIZE;
      renderTable(false);
    });
    el('csv').addEventListener('click', exportCsv);
    el('historyPastWeekMode')?.addEventListener('change', (event) => {
      void setPastWeekMode(Boolean(event.currentTarget.checked));
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) state.controller?.abort();
    });

    const requestedMode = location.hash.slice(1);
    state.mode = MODES[requestedMode] ? requestedMode : 'weekly';
    updateModeUi();
    updateSummary();
    const startupToken = ++state.requestToken;
    const runtimeMode = dataMode();
    try {
      await ensureModeRuntime(runtimeMode);
    } catch (error) {
      if (startupToken === state.requestToken) {
        console.error('history mode runtime failed to start', error);
        setNotice('表示機能の初期化に失敗しました。再読み込みしてください。', true);
      }
      return;
    }
    if (startupToken !== state.requestToken || dataMode() !== runtimeMode) return;
    void loadMode();
  }

  window.addEventListener('history:select-mode', event => void setMode(event.detail?.mode));
  void start();
})();
