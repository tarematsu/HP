(() => {
  'use strict';

  const PAGE_SIZE = 200;
  const CACHE_PREFIX = 'sh.history.v3:';
  const MAX_CACHE_CHARS = 1_500_000;
  const integer = new Intl.NumberFormat('ja-JP');
  const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
  const dateOnly = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const dateTime = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const MODES = Object.freeze({
    daily: { title: '日次集計', table: '日次集計一覧', chart: '同接・再生数の推移' },
    weekly: { title: '週次集計', table: '週次集計一覧', chart: '同接・再生数の推移' },
    monthly: { title: '月次集計', table: '月次集計一覧', chart: '同接・再生数の推移' },
    ranking: { title: '週間リーダーボード', table: '週間リーダーボード', chart: '' },
    broadcasts: { title: '公式ストリーム比較', table: '公式ストリーム一覧', chart: '公式ステヘ 同接推移（開始0分比較）' },
  });

  const SUMMARY_COLUMNS = [
    ['period_key', '期間'], ['sample_count', '記録数'], ['reliable_sample_count', '有効記録数'],
    ['listener_avg', '平均同接'], ['listener_min', '最小同接'], ['listener_max', '最大同接'],
    ['stream_start', '再生数（開始）'], ['stream_end', '再生数（終了）'], ['stream_growth', '再生数増加'],
    ['member_start', 'メンバー（開始）'], ['member_end', 'メンバー（終了）'], ['member_growth', 'メンバー増加'],
    ['likes_max', '最大いいね'], ['distinct_tracks', '曲数'], ['primary_host', '主なホスト'], ['quality_score', '品質'],
  ];
  const BROADCAST_COLUMNS = [
    ['event_name', '放送名'], ['started_at', '開始日時（UTC）'], ['ended_at', '終了日時（UTC）'],
    ['sample_count', '記録数'], ['listener_avg', '平均同接'], ['listener_min', '最小同接'],
    ['listener_max', '最大同接'], ['likes_max', '最大いいね'], ['distinct_tracks', '曲数'], ['host_handle', 'ホスト'],
  ];
  const RANKING_COLUMNS = [
    ['ranking_date', '週'], ['host_name', 'ホスト'], ['rank', '順位'], ['previous_rank', '前週順位'],
    ['rank_change', '前週比'], ['ranking_type', 'ランキング種別'], ['source_sheet', '順位データ出典'], ['quality_score', '品質'],
  ];

  const state = {
    mode: 'weekly',
    rows: [],
    tableRows: [],
    visibleRows: PAGE_SIZE,
    data: null,
    controller: null,
    requestToken: 0,
  };

  const el = (id) => document.getElementById(id);
  const finite = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  const numberText = (value) => finite(value) == null ? '—' : decimal.format(Number(value));
  const todayUtc = () => new Date().toISOString().slice(0, 10);

  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(`${text}T00:00:00Z`);
    const number = Number(value);
    return Number.isFinite(number) && number > 100_000_000_000 ? new Date(number) : new Date(text);
  }

  function formatDate(value, includeTime = false) {
    const date = parseDate(value);
    if (!date || Number.isNaN(date.getTime())) return '—';
    return (includeTime ? dateTime : dateOnly).format(date);
  }

  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = String(value);
  }

  function setNotice(text, error = false) {
    setText('notice', text);
    el('notice')?.classList.toggle('error', error);
  }

  function cacheKey(url) {
    return `${CACHE_PREFIX}${url}`;
  }

  function readCache(url, ttl) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(cacheKey(url)) || 'null');
      return cached && Date.now() - Number(cached.at || 0) < ttl ? cached.data : null;
    } catch {
      return null;
    }
  }

  function writeCache(url, data) {
    try {
      const encoded = JSON.stringify({ at: Date.now(), data });
      if (encoded.length <= MAX_CACHE_CHARS) sessionStorage.setItem(cacheKey(url), encoded);
    } catch {}
  }

  async function fetchJson(url, { ttl = 5 * 60_000, signal, force = false } = {}) {
    if (force) sessionStorage.removeItem(cacheKey(url));
    const cached = force ? null : readCache(url, ttl);
    if (cached) return { data: cached, cached: true };
    const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || `API ${response.status}`);
    writeCache(url, data);
    return { data, cached: false };
  }

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

  function columnsFor(mode) {
    if (mode === 'ranking') return RANKING_COLUMNS;
    if (mode === 'broadcasts') return BROADCAST_COLUMNS;
    return SUMMARY_COLUMNS;
  }

  function displayCell(key, row) {
    const value = row?.[key];
    if (value == null || value === '') return '—';
    if (key.endsWith('_at')) return formatDate(value, true);
    if (key === 'quality_score') return numberText(value);
    if (['rank_change', 'stream_growth', 'member_growth'].includes(key)) {
      const number = finite(value);
      return number == null ? '—' : `${number > 0 ? '+' : ''}${integer.format(number)}`;
    }
    if (typeof value === 'number') return numberText(value);
    return String(value);
  }

  function tableOrder(rows, mode) {
    if (mode === 'ranking') {
      return [...rows].sort((a, b) => String(b.ranking_date || '').localeCompare(String(a.ranking_date || ''))
        || Number(a.rank || 9999) - Number(b.rank || 9999));
    }
    return [...rows].reverse();
  }

  function renderTable(reset = false) {
    if (reset) state.visibleRows = PAGE_SIZE;
    const columns = columnsFor(state.mode);
    const head = document.createElement('tr');
    for (const [, label] of columns) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      head.appendChild(cell);
    }
    el('thead').replaceChildren(head);

    const rows = state.tableRows.slice(0, state.visibleRows);
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const tr = document.createElement('tr');
      for (const [key] of columns) {
        const td = document.createElement('td');
        td.textContent = displayCell(key, row);
        tr.appendChild(td);
      }
      fragment.appendChild(tr);
    }
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = columns.length;
      td.textContent = 'データがありません。';
      tr.appendChild(td);
      fragment.appendChild(tr);
    }
    el('tbody').replaceChildren(fragment);
    el('more').hidden = state.tableRows.length <= state.visibleRows;
  }

  function renderRankingWeekly(rows) {
    const head = document.createElement('tr');
    for (const label of ['週', '平均同接', '再生数増加', 'メンバー増加']) {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    }
    const body = document.createDocumentFragment();
    for (const row of Array.isArray(rows) ? rows : []) {
      const tr = document.createElement('tr');
      for (const value of [row.period_key, numberText(row.listener_avg), numberText(row.stream_growth), numberText(row.member_growth)]) {
        const td = document.createElement('td');
        td.textContent = value ?? '—';
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    el('rankingWeeklyThead').replaceChildren(head);
    el('rankingWeeklyTbody').replaceChildren(body);
  }

  function average(rows, key) {
    const values = rows.map((row) => finite(row?.[key])).filter((value) => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  }

  function updateSummary() {
    const rows = state.rows;
    setText('periodLabel', state.mode === 'ranking' ? '順位行' : '期間数');
    setText('maxLabel', '平均同接');
    setText('streamLabel', '再生数増加');
    setText('memberLabel', 'メンバー増加');
    setText('periods', numberText(rows.length));
    if (state.mode === 'ranking') {
      setText('maxListener', '—');
      setText('streamGrowth', '—');
      setText('memberGrowth', '—');
      return;
    }
    setText('maxListener', numberText(average(rows, 'listener_avg')));
    setText('streamGrowth', numberText(average(rows, 'stream_growth')));
    setText('memberGrowth', numberText(average(rows, 'member_growth')));
  }

  function updateModeUi() {
    const config = MODES[state.mode];
    document.querySelectorAll('#modeTabs button').forEach((button) => {
      const selected = button.dataset.mode === state.mode;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else if (button.dataset.view !== 'current') button.removeAttribute('aria-current');
    });
    setText('guideTitle', config.title);
    setText('tableTitle', config.table);
    setText('chartTitle', config.chart);
    el('controls').hidden = state.mode === 'broadcasts';
    el('standardControls').hidden = false;
    el('rankingControls').hidden = state.mode !== 'ranking';
    el('chartPanel').hidden = state.mode === 'ranking';
    el('rankingWeeklyPanel').hidden = state.mode !== 'ranking';
    setText('chartFoot', state.mode === 'broadcasts'
      ? '横軸は各放送の開始からの経過時間です。'
      : '左軸は同接（平均・最大・最小）、右軸は各期間の再生数増加です。');
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
    state.tableRows = tableOrder(state.rows, state.mode);
    renderTable(true);
    renderRankingWeekly(state.data?.weekly_metrics || []);
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
    const mode = state.mode;
    el('load').disabled = true;
    setNotice('読み込み中…');

    try {
      if (mode === 'broadcasts') {
        el('from').value = '2024-05-01';
        el('to').value = todayUtc();
      }
      const from = el('from').value;
      const to = el('to').value;
      const params = new URLSearchParams({ mode, from, to });
      if (mode === 'ranking') {
        params.set('scope', el('rankingScope').value);
        params.set('limit', '5000');
        const host = el('rankingHost').value.trim();
        if (host) params.set('host', host);
      }
      const url = `/api/history?${params}`;
      const ttl = mode === 'broadcasts' ? 15 * 60_000 : 5 * 60_000;
      const { data, cached } = await fetchJson(url, { ttl, signal: controller.signal, force });
      if (token !== state.requestToken || state.mode !== mode) return;

      state.data = data;
      state.rows = Array.isArray(data.rows) ? data.rows : [];
      if (mode === 'ranking') {
        setNotice(`${numberText(state.rows.length)}行${data.truncated ? ' · 最大5000件' : ''}${cached ? ' · キャッシュ' : ''}`);
      } else {
        setNotice(`${numberText(state.rows.length)}件を表示 · UTC${cached ? ' · キャッシュ' : ''}`);
      }
      renderLoadedData();
      publishHistoryData(mode, data, from, to, cached);
    } catch (error) {
      if (error?.name !== 'AbortError' && token === state.requestToken) {
        console.error(error);
        resetData();
        renderLoadedData();
        setNotice(`データを取得できませんでした: ${error.message}`, true);
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
    history.replaceState(null, '', `#${mode}`);
    try {
      await ensureModeRuntime(mode);
    } catch (error) {
      if (transitionToken === state.requestToken) {
        console.error('history mode runtime failed to load', error);
        setNotice('表示機能の読み込みに失敗しました。再読み込みしてください。', true);
      }
      return;
    }
    if (transitionToken !== state.requestToken || state.mode !== mode) return;
    void loadMode();
  }

  function exportCsv() {
    const columns = columnsFor(state.mode);
    const lines = [
      columns.map(([, label]) => label),
      ...state.rows.map((row) => columns.map(([key]) => displayCell(key, row))),
    ].map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','));
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sh-${state.mode}-${todayUtc()}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function start() {
    el('to').value = todayUtc();
    applyPreset('all');
    document.querySelectorAll('#modeTabs button').forEach((button) =>
      button.addEventListener('click', () => void setMode(button.dataset.mode)));
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
    el('rankingScope').addEventListener('change', () => void loadMode());
    el('rankingHost').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void loadMode();
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) state.controller?.abort();
    });

    const requestedMode = location.hash.slice(1);
    state.mode = MODES[requestedMode] ? requestedMode : 'weekly';
    updateModeUi();
    const startupToken = ++state.requestToken;
    try {
      await ensureModeRuntime(state.mode);
    } catch (error) {
      if (startupToken === state.requestToken) {
        console.error('history mode runtime failed to start', error);
        setNotice('表示機能の初期化に失敗しました。再読み込みしてください。', true);
      }
      return;
    }
    if (startupToken !== state.requestToken) return;
    void loadMode();
  }

  void start();
})();
