import {
  appendEmptyTableRow,
  byId as el,
  decimalOneFormat as decimal,
  finiteNumber as finite,
  integerFormat as integer,
  setNotice as setSharedNotice,
  setText,
} from '../dashboard-ui-common.js?v=20260930.1';
import { downloadCsv } from '../csv-download.js?v=20261001.1';
import { durationLabel } from '../official-listening-party-ui.js?v=20261001.1';
import {
  fetchHistoryPayload,
  historyCacheTtl,
  migrateHistoryCache,
} from './history-data-client.js';

(() => {
  'use strict';

  const PAGE_SIZE = 200;
  const CACHE_PREFIX = 'sh.history.v3:';
  const MAX_CACHE_CHARS = 1_500_000;
  const OFFICIAL_EVENT_DATE_GAP = /(\d{4}[./-]\d{1,2}[./-]\d{1,2})[ \u3000]+(?=『)/g;
  const dateOnly = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const dateTime = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });

  const MODES = Object.freeze({
    daily: { title: '日次集計', table: '日次集計一覧', chart: '同接・再生数増加の推移' },
    weekly: { title: '週次集計', table: '週次集計一覧', chart: '同接・再生数増加の推移' },
    monthly: { title: '月次集計', table: '月次集計一覧', chart: '同接・再生数増加の推移' },
    ranking: { title: '週間リーダーボード', table: '週間リーダーボード', chart: '' },
    broadcasts: { title: '公式リスパ比較', table: '公式リスパ一覧', chart: '公式リスパ 同接推移（開始0分比較）' },
  });

  const SUMMARY_COLUMNS = [
    ['period_key', '期間'],
    ['sample_count', '取得記録数', 'その期間に保存された全サンプル数'],
    ['listener_avg', '平均同接'],
    ['listener_min', '最小同接'],
    ['listener_max', '最大同接'],
    ['stream_start', '再生数（開始）'],
    ['stream_end', '再生数（終了）'],
    ['stream_growth', '再生数増加'],
    ['member_start', 'メンバー数（開始）', '期間開始時点のメンバー数'],
    ['member_end', 'メンバー数（終了）', '期間終了時点のメンバー数'],
    ['member_growth', 'メンバー増加数', '期間内のメンバー数の増加'],
    ['distinct_tracks', '楽曲数', '期間内に確認された楽曲数'],
  ];
  const BROADCAST_COLUMNS = [
    ['event_name', '放送名'], ['started_at', '開始日時（UTC）'], ['ended_at', '終了日時（UTC）'],
    ['sample_count', '記録数'], ['listener_avg', '平均同接'], ['listener_min', '最小同接'],
    ['listener_max', '最大同接'], ['likes_max', '最大いいね'], ['distinct_tracks', '曲数'], ['host_handle', 'ホスト'],
  ];
  const RANKING_COLUMNS = [
    ['ranking_date', '週'],
    ['rank', '順位'],
    ['host_name', 'ホスト'],
    ['stationhead_channel_name', 'チャンネル'],
    ['artist_name', 'アーティスト名'],
    ['relation_label', '種別'],
  ];

  const state = {
    mode: 'weekly',
    pastWeekMode: false,
    rows: [],
    tableRows: [],
    visibleRows: PAGE_SIZE,
    data: null,
    rankingMetadataByHost: new Map(),
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
    const data = await fetchHistoryPayload(url, { signal });
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

  function hostKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function rebuildRankingMetadata() {
    state.rankingMetadataByHost.clear();
    for (const row of state.rows) {
      const key = hostKey(row?.host_name);
      if (!key) continue;
      const current = state.rankingMetadataByHost.get(key) || {};
      const artist = String(row?.artist_name || current.artist_name || '').trim();
      state.rankingMetadataByHost.set(key, {
        stationhead_channel_name: String(row?.stationhead_channel_name || current.stationhead_channel_name || '').trim(),
        artist_name: artist,
        fandom_type: row?.fandom_type || current.fandom_type || null,
      });
    }
  }

  function rankingMetadata(row) {
    return state.rankingMetadataByHost.get(hostKey(row?.host_name)) || {};
  }

  function displayCell(key, row) {
    let value = row?.[key];
    if (key === 'stationhead_channel_name') value = value || rankingMetadata(row).stationhead_channel_name;
    if (key === 'artist_name') value = value || rankingMetadata(row).artist_name;
    if (key === 'relation_label') {
      const metadata = rankingMetadata(row);
      const artist = String(row?.artist_name || metadata.artist_name || '').trim();
      value = artist ? ((row?.fandom_type || metadata.fandom_type) === 'official' ? '公式' : 'ファンダム') : null;
    }
    if (value == null || value === '') return '—';
    if (key === 'event_name') return String(value).replace(OFFICIAL_EVENT_DATE_GAP, '$1');
    if (key.endsWith('_at')) return formatDate(value, true);
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

  function syncTableModeClass(mode) {
    const table = el('thead')?.closest('table');
    if (!table) return;
    table.classList.toggle('compact-columns', mode === 'ranking');
    table.classList.toggle('official-party-table', mode === 'broadcasts');
    table.classList.remove('all-host-ranking-table');
  }

  function renderTable(reset = false) {
    if (reset) state.visibleRows = PAGE_SIZE;
    const mode = dataMode();
    const columns = columnsFor(mode);
    syncTableModeClass(mode);
    const head = document.createElement('tr');
    for (const [, label, title] of columns) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = label;
      if (title) cell.title = title;
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
    if (!rows.length) appendEmptyTableRow(fragment, 'データがありません。', columns.length);
    el('tbody').replaceChildren(fragment);
    el('more').hidden = state.tableRows.length <= state.visibleRows;
  }

  function renderRankingWeekly(rows) {
    const head = document.createElement('tr');
    for (const label of ['週', '平均同接', '再生数増加', 'メンバー増加数']) {
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

  function isoDate(value) {
    const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(String(value || '').trim());
    if (!match) return '';
    return `${match[1]}-${String(Number(match[2])).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
  }

  function mondayOnOrBefore(value) {
    const iso = isoDate(value);
    if (!iso) return '';
    const date = new Date(`${iso}T00:00:00Z`);
    const delta = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - delta);
    return date.toISOString().slice(0, 10);
  }

  function rankingWeekCounts(payload) {
    const rows = Array.isArray(payload?.rows) ? payload.rows : [];
    const singleHost = Array.isArray(payload?.chart_hosts) && payload.chart_hosts.length === 1;
    const sourceWeeks = singleHost
      ? rows.map((row) => row?.ranking_date)
      : Array.isArray(payload?.ranking_weeks) && payload.ranking_weeks.length
        ? payload.ranking_weeks
        : rows.map((row) => row?.ranking_date);
    const weekKeys = new Set(sourceWeeks.map(mondayOnOrBefore).filter(Boolean));
    const totalWeeks = weekKeys.size;
    const rankedWeeks = new Set(rows
      .filter((row) => finite(row?.rank) > 0)
      .map((row) => mondayOnOrBefore(row?.ranking_date))
      .filter((week) => weekKeys.has(week))).size;
    return { totalWeeks, rankedWeeks, outWeeks: Math.max(0, totalWeeks - rankedWeeks) };
  }

  function setSummary(labels, values) {
    if (!state.data) values = { periods: '—', max: '—', stream: '—', member: '—' };
    setText('periodLabel', labels.period);
    setText('maxLabel', labels.max);
    setText('streamLabel', labels.stream);
    setText('memberLabel', labels.member);
    setText('periods', values.periods);
    setText('maxListener', values.max);
    setText('streamGrowth', values.stream);
    setText('memberGrowth', values.member);
  }

  function updateSummary() {
    const rows = state.rows;
    const mode = dataMode();
    if (mode === 'ranking') {
      const data = state.data || {};
      const singleSelectedHost = data.scope === 'all'
        && Array.isArray(data.chart_hosts)
        && data.chart_hosts.length === 1;
      if (data.scope === 'all' && !singleSelectedHost) {
        const summary = data.ranking_summary || {};
        setSummary(
          { period: '対象週数', max: '掲載ホスト数', stream: '延べランクイン数', member: '圏外・欠測数' },
          {
            periods: integer.format(Number(summary.week_count || 0)),
            max: integer.format(Number(summary.listed_host_count ?? summary.host_count ?? 0)),
            stream: integer.format(Number(summary.ranked_entry_count || 0)),
            member: integer.format(Number(summary.out_of_rank_count || 0)),
          },
        );
      } else {
        const { totalWeeks, rankedWeeks, outWeeks } = rankingWeekCounts(data);
        setSummary(
          { period: '総週数', max: 'ランクイン週数', stream: '圏外・欠測週数', member: '対象ホスト' },
          {
            periods: integer.format(totalWeeks),
            max: integer.format(rankedWeeks),
            stream: integer.format(outWeeks),
            member: integer.format(Number(data.host_count || 0)),
          },
        );
      }
      return;
    }

    if (mode === 'broadcasts') {
      const maximums = rows.map((row) => finite(row?.listener_max)).filter((value) => value != null);
      const durations = rows.map((row) => {
        const start = finite(row?.started_at);
        const end = finite(row?.ended_at);
        return start == null || end == null || end < start ? null : (end - start) / 60_000;
      }).filter((value) => value != null);
      setSummary(
        { period: '期間数', max: '平均同接', stream: '最大同接', member: '平均所要時間' },
        {
          periods: numberText(rows.length),
          max: numberText(average(rows, 'listener_avg')),
          stream: maximums.length ? integer.format(Math.max(...maximums)) : '—',
          member: durations.length ? durationLabel(durations.reduce((sum, value) => sum + value, 0) / durations.length) : '—',
        },
      );
      return;
    }

    setSummary(
      { period: '期間数', max: '平均同接', stream: '平均再生数増加量', member: '平均メンバー増加数' },
      {
        periods: numberText(rows.length),
        max: numberText(average(rows, 'listener_avg')),
        stream: numberText(average(rows, 'stream_growth')),
        member: numberText(average(rows, 'member_growth')),
      },
    );
  }

  function updateModeUi() {
    const mode = dataMode();
    const config = MODES[mode];
    document.querySelectorAll('#modeTabs button').forEach((button) => {
      const selected = button.dataset.mode === state.mode;
      button.classList.toggle('active', selected);
      if (selected) button.setAttribute('aria-current', 'page');
      else if (button.dataset.view !== 'current') button.removeAttribute('aria-current');
    });
    const toggle = el('historyPastWeekToggle');
    if (toggle) toggle.hidden = state.mode !== 'daily';
    const checkbox = el('historyPastWeekMode');
    if (checkbox) checkbox.checked = state.pastWeekMode;
    setText('guideTitle', config.title);
    setText('tableTitle', config.table);
    setText('chartTitle', config.chart);
    el('controls').hidden = state.mode === 'broadcasts';
    el('standardControls').hidden = false;
    el('rankingControls').hidden = state.mode !== 'ranking';
    el('chartPanel').hidden = state.mode === 'ranking';
    el('rankingWeeklyPanel').hidden = state.mode !== 'ranking';
    setText('chartFoot', state.mode === 'broadcasts'
      ? '各線は1回の公式リスパです。横軸は各開催の開始からの経過時間です。'
      : '');
  }

  function resetData() {
    state.rows = [];
    state.tableRows = [];
    state.data = null;
    state.rankingMetadataByHost.clear();
    state.visibleRows = PAGE_SIZE;
    el('tbody').replaceChildren();
    el('chartLegend').replaceChildren();
  }

  function renderLoadedData() {
    rebuildRankingMetadata();
    updateSummary();
    state.tableRows = tableOrder(state.rows, dataMode());
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
      if (routeMode === 'ranking') {
        params.set('scope', el('rankingScope').value);
        params.set('limit', '5000');
        const host = el('rankingHost').value.trim();
        if (host) params.set('host', host);
      }
      const url = `/api/history?${params}`;
      const { data, cached } = await fetchJson(url, {
        ttl: historyCacheTtl(mode),
        signal: controller.signal,
        force,
      });
      if (token !== state.requestToken || state.mode !== routeMode || dataMode() !== mode) return;

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
    el('historyPastWeekMode')?.addEventListener('change', (event) => {
      void setPastWeekMode(Boolean(event.currentTarget.checked));
    });
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

  void start();
})();
