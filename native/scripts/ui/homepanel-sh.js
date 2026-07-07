(() => {
  'use strict';

  const root = window.HomePanel;
  const { $, text, setHidden } = root.utils;
  const stationheadStaleMs = 120000;

  let progressState = null;

  function formatRelativeAge(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '更新待ち';
    if (ms < 1000) return 'たった今更新';
    if (ms < 60000) return `${Math.round(ms / 1000)}秒前更新`;
    return `${Math.round(ms / 60000)}分前更新`;
  }

  function setLiveStatus(prefix, kind, detail) {
    const badge = $(`#stationhead-${prefix}-live-badge`) || $('#sp-live-badge');
    const textNode = $(`#stationhead-${prefix}-live-text`) || $('#sp-live-text');
    if (!badge || !textNode) return;

    const labels = {
      live: 'LIVE',
      paused: 'PAUSED',
      stale: 'STALE',
      silent: 'SILENT',
      offline: 'OFFLINE',
    };

    badge.className = `sp-live-badge ${kind}`;
    badge.textContent = labels[kind] || labels.offline;
    textNode.textContent = detail || '情報待ち';
  }

  function formatProgressTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '0:00';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function tickProgress() {
    const bar = $('#sp-progress-bar');
    const fill = $('#sp-progress-fill');
    const elapsedEl = $('#sp-elapsed');
    const remainingEl = $('#sp-remaining');
    if (!bar || !fill || !progressState) return;

    const { sampledAt, expectedEndAt, trackDurationMs, playing } = progressState;
    if (!trackDurationMs || !sampledAt) {
      bar.hidden = true;
      return;
    }

    const now = Date.now();
    const hasExpectedEnd = Number.isFinite(expectedEndAt) && expectedEndAt > sampledAt;
    const progressAtSample = hasExpectedEnd ? Math.max(0, trackDurationMs - (expectedEndAt - sampledAt)) : 0;
    const elapsedMs = hasExpectedEnd && playing
      ? Math.max(0, progressAtSample + (now - sampledAt))
      : Math.max(0, progressAtSample);
    const cappedElapsed = Math.min(elapsedMs, trackDurationMs);
    const pct = (cappedElapsed / trackDurationMs) * 100;
    const remMs = Math.max(0, trackDurationMs - cappedElapsed);
    const transform = `scaleX(${(pct / 100).toFixed(4)})`;

    if (fill.style.transform !== transform) fill.style.transform = transform;
    const elapsed = formatProgressTime(cappedElapsed);
    if (elapsedEl && elapsedEl.textContent !== elapsed) elapsedEl.textContent = elapsed;
    const remaining = `-${formatProgressTime(remMs)}`;
    if (remainingEl && remainingEl.textContent !== remaining) remainingEl.textContent = remaining;
    setHidden(bar, false);
  }

  function setArtwork(prefix, artwork, waiting = false) {
    const image = $(`#stationhead-${prefix}-artwork`) || (prefix === 'a' ? $('#spotify-artwork') : null);
    const fallback = $(`#stationhead-${prefix}-artwork-fallback`) || (prefix === 'a' ? $('#spotify-artwork-fallback') : null);
    const wait = $(`#stationhead-${prefix}-artwork-wait`);
    const shell = $(`#stationhead-${prefix}-artwork-shell`);

    if (shell) shell.classList.toggle('is-waiting', Boolean(waiting));
    if (wait) setHidden(wait, !waiting);

    if (!(image instanceof HTMLImageElement)) return;
    if (artwork) {
      image.onload = () => {
        image.hidden = false;
        if (fallback) fallback.hidden = true;
      };
      image.onerror = () => {
        image.hidden = true;
        if (fallback) fallback.hidden = false;
      };
      if (image.getAttribute('src') !== artwork) image.src = artwork;
      image.hidden = false;
      if (fallback) fallback.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      if (fallback) fallback.hidden = false;
    }
  }

  function normalizeTrack(value = {}, fallback = {}) {
    const item = fallback.item || {};
    return {
      title: value.trackTitle || value.name || item.name || '--',
      artist: value.trackArtist || value.artist || item.artist || '--',
      artwork: value.artworkUrl || value.artwork || item.artwork || item.albumArtUrl || item.image || item.imageUrl || '',
      playing: Boolean(value.playing ?? fallback.playing),
      sampledAt: Number(value.sampledAt || fallback.sampledAt) || 0,
      expectedEndAt: Number(value.expectedEndAt || fallback.expectedEndAt) || 0,
      trackDurationMs: Number(value.trackDurationMs || fallback.trackDurationMs) || 0,
      audioSilent: Boolean(value.audioSilent),
      created: value.created ?? fallback.created,
      waiting: Boolean(value.waiting || fallback.waiting || item.waiting),
    };
  }

  function renderWindow(prefix, source, fallback = {}) {
    const track = normalizeTrack(source, fallback);
    const silent = track.audioSilent;
    const title = silent ? '-' : track.title;
    const artist = silent ? '-' : track.artist;

    text(`#stationhead-${prefix}-track`, title);
    text(`#stationhead-${prefix}-artist`, artist);

    const ageMs = track.sampledAt > 0 ? Math.max(0, Date.now() - track.sampledAt) : Number.POSITIVE_INFINITY;
    const stale = track.sampledAt > 0 && ageMs > stationheadStaleMs;

    if (!track.created && title === '--' && artist === '--') {
      setLiveStatus(prefix, 'offline', prefix === 'b' ? 'API情報待ち' : '情報待ち');
    } else if (silent) {
      setLiveStatus(prefix, 'silent', '音声が止まっています');
    } else if (stale) {
      setLiveStatus(prefix, 'stale', formatRelativeAge(ageMs));
    } else if (track.playing) {
      setLiveStatus(prefix, 'live', formatRelativeAge(ageMs));
    } else {
      setLiveStatus(prefix, 'paused', track.sampledAt > 0 ? formatRelativeAge(ageMs) : '停止中');
    }

    setArtwork(prefix, silent ? '' : track.artwork, track.waiting);
    return track;
  }

  function renderStationhead(value = {}) {
    const cloud = root.state.cloudStationhead || {};
    const a = renderWindow('a', value, cloud);
    renderWindow('b', cloud, {});

    if (a.trackDurationMs > 0 && a.sampledAt > 0 && !a.audioSilent) {
      progressState = {
        sampledAt: a.sampledAt,
        expectedEndAt: a.expectedEndAt,
        trackDurationMs: a.trackDurationMs,
        playing: a.playing,
      };
      tickProgress();
    } else {
      progressState = null;
      const bar = $('#sp-progress-bar');
      if (bar) bar.hidden = true;
    }
  }

  root.panels = root.panels || {};
  root.panels.stationhead = { renderStationhead, tickProgress };
})();
