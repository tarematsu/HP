import {
  displayTrackArtist,
  displayTrackTitle,
} from './history-track-view.js';

(() => {
  'use strict';

  const CACHE_PREFIX = 'sh.track-like-ranking.v1:';
  const CACHE_MS = 5 * 60_000;
  const number = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
  const dateTime = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const shortDate = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'UTC', month: 'numeric', day: 'numeric',
  });

  const state = { rows: [], summary: {}, controller: null };
  const el = (id) => document.getElementById(id);
  if (!el('likesView')) return;

  const finite = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const fmt = (value) => finite(value) == null ? '—' : number.format(Number(value));
  const trackName = (row) => displayTrackTitle(row);
  const artistName = (row) => displayTrackArtist(row);

  function setNotice(text, error = false) {
    el('likesNotice').textContent = text;
    el('likesNotice').classList.toggle('error', error);
  }

  function readCache(url) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(`${CACHE_PREFIX}${url}`) || 'null');
      return cached && Date.now() - Number(cached.at || 0) < CACHE_MS ? cached.data : null;
    } catch {
      return null;
    }
  }

  function writeCache(url, data) {
    try {
      sessionStorage.setItem(`${CACHE_PREFIX}${url}`, JSON.stringify({ at: Date.now(), data }));
    } catch {}
  }

  async function fetchJson(url, signal, force) {
    if (force) sessionStorage.removeItem(`${CACHE_PREFIX}${url}`);
    const cached = force ? null : readCache(url);
    if (cached) return { data: cached, cached: true };
    const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok || !data?.ok) throw new Error(data?.error || `API ${response.status}`);
    writeCache(url, data);
    return { data, cached: false };
  }

  function renderSummary() {
    el('likesTrackCount').textContent = fmt(state.summary.track_count || 0);
    el('likesMaxLikes').textContent = fmt(state.summary.max_like_count || 0);
    el('likesLatestAt').textContent = state.summary.latest_observed_at
      ? shortDate.format(new Date(Number(state.summary.latest_observed_at)))
      : '—';
  }

  function metric(label, value) {
    const box = document.createElement('span');
    box.append(document.createTextNode(label));
    const strong = document.createElement('b');
    strong.textContent = value;
    box.appendChild(strong);
    return box;
  }

  function renderRanking() {
    const list = el('likesRankingList');
    list.replaceChildren();
    const rows = state.rows.slice(0, 50);
    if (!rows.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-ranking';
      empty.textContent = 'データがありません。';
      list.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const item = document.createElement('li');
      item.className = 'like-rank-item';
      const rank = document.createElement('strong');
      rank.className = 'like-rank-number';
      rank.textContent = String(row.rank);
      const content = document.createElement('div');
      content.className = 'like-rank-content';
      const heading = document.createElement('div');
      heading.className = 'like-rank-heading';
      const title = document.createElement('span');
      title.textContent = trackName(row);
      heading.appendChild(title);
      const artist = document.createElement('small');
      artist.textContent = artistName(row);
      content.append(heading, artist);
      const metrics = document.createElement('div');
      metrics.className = 'like-rank-metrics';
      metrics.append(metric('最新いいね', fmt(row.latest_like_count)));
      item.append(rank, content, metrics);
      fragment.appendChild(item);
    }
    list.appendChild(fragment);
  }

  function renderTable() {
    const body = el('likesTbody');
    body.replaceChildren();
    if (!state.rows.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 5;
      cell.textContent = 'データがありません。';
      row.appendChild(cell);
      body.appendChild(row);
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const item of state.rows) {
      const row = document.createElement('tr');
      for (const value of [
        item.rank,
        trackName(item),
        artistName(item),
        fmt(item.latest_like_count),
        item.latest_observed_at ? dateTime.format(new Date(Number(item.latest_observed_at))) : '—',
      ]) {
        const cell = document.createElement('td');
        cell.textContent = String(value);
        row.appendChild(cell);
      }
      fragment.appendChild(row);
    }
    body.appendChild(fragment);
  }

  function render() {
    renderSummary();
    renderRanking();
    renderTable();
  }

  async function load({ force = false } = {}) {
    state.controller?.abort();
    const controller = new AbortController();
    state.controller = controller;
    el('likesLoad').disabled = true;
    setNotice('読み込み中…');
    const url = '/api/track-history?ranking_only=1&ranking_limit=500';
    try {
      const result = await fetchJson(url, controller.signal, force);
      if (controller.signal.aborted) return;
      state.rows = Array.isArray(result.data.ranking) ? result.data.ranking : [];
      state.summary = result.data.ranking_summary || {};
      render();
      setNotice(`${fmt(state.rows.length)}曲${result.cached ? ' · キャッシュ' : ''}`);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      state.rows = [];
      state.summary = {};
      render();
      setNotice(`取得失敗: ${error.message}`, true);
    } finally {
      if (state.controller === controller) {
        state.controller = null;
        el('likesLoad').disabled = false;
      }
    }
  }

  function exportCsv() {
    const header = ['順位', '曲名', 'アーティスト', '最新いいね', '最終観測'];
    const lines = [header, ...state.rows.map((row) => [
      row.rank,
      trackName(row),
      artistName(row),
      row.latest_like_count,
      row.latest_observed_at ? new Date(Number(row.latest_observed_at)).toISOString() : '',
    ])].map((line) => line.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(','));
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `sh-like-ranking-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  el('likesLoad').addEventListener('click', () => load({ force: true }));
  el('likesCsv').addEventListener('click', exportCsv);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) state.controller?.abort();
    else if (!el('likesView').hidden) load();
  });
  load();
})();
