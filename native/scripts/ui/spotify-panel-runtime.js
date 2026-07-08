(() => {
  'use strict';

  const PLAYBACK_STALE_MS = 6 * 60 * 1000;
  const TRACK_TRANSITION_HOLD_MS = 1000;

  const PLAYBACK_SOURCES = Object.freeze({
    a: Object.freeze({ channel: 'buddies', prefix: 'stationhead-a' }),
    b: Object.freeze({ channel: 'buddy46', prefix: 'stationhead-b' }),
  });
  const PLAYBACK_SOURCE_KEYS = Object.freeze(Object.keys(PLAYBACK_SOURCES));

  let dashboard = {};
  let panelHeaderMetaHandled = false;
  const shared = window.__homepanelPlaybackShared;
  const utils = window.HomePanel?.utils || {};
  const asObject = shared.asObject;
  const normalizePlaybackPayload = shared.normalizePlaybackPayload;
  const formatTime = shared.formatTime;
  const normalizedItem = shared.normalizedItem;
  const queueFrom = shared.queueFrom;

  const playbackStates = {
    a: { value: {}, fetchedAt: 0, error: '', revision: 0 },
    b: { value: {}, fetchedAt: 0, error: '', revision: 0 },
  };
  const audioUiState = {
    a: { muted: false },
    b: { muted: false },
  };
  const snapshotCache = {
    key: '',
    a: null,
    b: null,
  };

  const $ = utils.$ || (selector => document.querySelector(selector));
  const finite = utils.finite || (value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
  const escapeHtml = utils.escapeHtml || (value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  }[character])));

  function removePanelHeaderMeta() {
    if (panelHeaderMetaHandled) return;
    $('.spotify-panel > header .subtle')?.remove();
    panelHeaderMetaHandled = true;
  }

  function postNativeAction(action, value) {
    const message = { type: 'action', action };
    if (Number.isFinite(Number(value))) message.value = Number(value);
    window.chrome?.webview?.postMessage(message);
  }

  function updateAudioControls(key) {
    const state = audioUiState[key];
    if (!state) return;
    const button = $(`#stationhead-${key}-audio`);
    if (!button) return;
    button.classList.toggle('is-muted', Boolean(state.muted));
    button.setAttribute('aria-pressed', state.muted ? 'true' : 'false');
    const label = button.querySelector('span') || button;
    const next = state.muted ? '髻ｳ螢ｰOFF' : '髻ｳ螢ｰON';
    if (label.textContent !== next) label.textContent = next;
    button.title = state.muted ? '繧ｯ繝ｪ繝・け縺ｧ髻ｳ螢ｰON' : '繧ｯ繝ｪ繝・け縺ｧ髻ｳ螢ｰOFF';
  }

  function syncAudioControlsFromRuntime(state) {
    const stationhead = state?.stationhead;
    if (!stationhead || typeof stationhead !== 'object') return;
    if (typeof stationhead.audioMuted === 'boolean') audioUiState.a.muted = stationhead.audioMuted;
    if (typeof stationhead.secondaryAudioMuted === 'boolean') audioUiState.b.muted = stationhead.secondaryAudioMuted;
    updateAudioControls('a');
    updateAudioControls('b');
  }

  function installAudioControlHandlers() {
    document.addEventListener('click', event => {
      const button = event.target.closest('.stationhead-audio-toggle[data-audio-window]');
      if (!button || button.disabled) return;
      const key = button.dataset.audioWindow;
      if (!audioUiState[key]) return;
      postNativeAction(key === 'a' ? 'stationhead-audio-a' : 'stationhead-audio-b');
    });
    updateAudioControls('a');
    updateAudioControls('b');
  }

  function renderPlugs(value) {
    const container = $('#energy-plugs');
    if (!container) return;
    const devices = Array.isArray(value?.devices) ? value.devices : [];
    const plugs = devices.filter(device => /Plug Mini/i.test(String(device.deviceType || '')));
    const signature = JSON.stringify([
      value?.serviceAvailable, value?.__status, value?.degradedReason, value?.__error,
      plugs.map(device => [device.deviceId, device.deviceName, device.watts, device.power, device.error]),
    ]);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    const available = value?.serviceAvailable !== false && !['stale', 'error', 'waiting'].includes(value?.__status);
    if (!plugs.length) {
      container.innerHTML = `<div class="plug-empty">${available ? 'Plug Mini諠・ｱ縺ｪ縺・' : 'Plug Mini諠・ｱ繧貞叙蠕励〒縺阪∪縺帙ｓ'}</div>`;
      return;
    }
    container.innerHTML = plugs.map(device => {
      const online = available && !device.error;
      const raw = online ? String(device.power || '').trim().toUpperCase() : '';
      const state = raw === 'ON' ? 'ON' : raw === 'OFF' ? 'OFF' : '--';
      const watts = online && finite(device.watts) ? `${Number(device.watts).toFixed(1)} W` : '-- W';
      const name = device.deviceName || device.deviceId || 'Plug Mini';
      const reason = device.error || value?.degradedReason || value?.__error || '';
      const title = reason ? ` title="${escapeHtml(reason)}"` : '';
      return `<div class="energy-plug${online ? '' : ' is-unavailable'}"${title}><span class="energy-plug-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="energy-plug-watts">${escapeHtml(watts)}</span><b class="energy-plug-state ${state === 'ON' ? 'is-on' : state === 'OFF' ? 'is-off' : 'is-unknown'}">${state}</b></div>`;
    }).join('');
  }

  function setText(selector, value) {
    const node = $(selector);
    const next = String(value ?? '');
    if (node && node.textContent !== next) node.textContent = next;
  }

  function setBadge(prefix) {
    const badge = $(`#${prefix}-live-badge`);
    const text = $(`#${prefix}-live-text`);
    if (badge) {
      badge.hidden = true;
      if (badge.textContent) badge.textContent = '';
    }
    if (text) {
      text.hidden = true;
      if (text.textContent) text.textContent = '';
    }
  }

  function setArtwork(imageSelector, fallbackSelector, source) {
    const image = $(imageSelector);
    const fallback = $(fallbackSelector);
    if (!(image instanceof HTMLImageElement)) return;
    const url = String(source || '').trim();
    if (!url) {
      image.removeAttribute('src');
      image.hidden = true;
      if (fallback) fallback.hidden = false;
      return;
    }
    if (!image.dataset.homepanelArtworkEvents) {
      image.addEventListener('load', () => {
        image.hidden = false;
        if (fallback) fallback.hidden = true;
      });
      image.addEventListener('error', () => {
        image.hidden = true;
        if (fallback) fallback.hidden = false;
      });
      image.dataset.homepanelArtworkEvents = '1';
    }
    if (image.getAttribute('src') !== url) image.src = url;
    image.hidden = false;
    if (fallback) fallback.hidden = true;
  }

  function playerRow(prefix) {
    return document.getElementById(`${prefix}-track`)?.closest('.stationhead-player-row') || null;
  }

  function compactBody(prefix) {
    return playerRow(prefix)?.querySelector('.stationhead-compact-body') || null;
  }

  function ensureProgress(prefix) {
    const body = compactBody(prefix);
    if (!body) return null;
    let root = $(`#${prefix}-progress`);
    if (root) return root;
    root = document.createElement('div');
    root.id = `${prefix}-progress`;
    root.className = 'stationhead-progress';
    root.innerHTML = `<div class="stationhead-progress-track"><div id="${prefix}-progress-fill" class="stationhead-progress-fill"></div></div><div class="stationhead-progress-time"><span id="${prefix}-progress-current">0:00</span><span id="${prefix}-progress-duration">0:00</span></div>`;
    body.appendChild(root);
    return root;
  }

  function unwrapPlaybackPayload(raw) {
    const root = asObject(raw);
    if (typeof root.title === 'string' || typeof root.hasTrack === 'boolean') return root;
    if (root.resolved && typeof root.resolved === 'object') return asObject(root.resolved);
    const candidates = [root.playback, asObject(root.data).playback, root.data, root.stationhead, root.result, root];
    for (const candidate of candidates) {
      const value = asObject(candidate);
      if (Object.keys(value).length) return value;
    }
    return {};
  }

  function playbackSnapshot(rawValue, now = Date.now()) {
    const value = unwrapPlaybackPayload(rawValue);
    if (Object.prototype.hasOwnProperty.call(value, 'hasTrack') &&
        Object.prototype.hasOwnProperty.call(value, 'durationMs')) {
      const durationMs = Math.max(0, Number(value.durationMs ?? 0) || 0);
      let progressMs = Math.max(0, Number(value.progressMs ?? value.positionMs ?? 0) || 0);
      const playing = value.playing === true;
      const anchorAt = Number(value.anchorAt ?? 0) || 0;
      const sampledAt = Number(value.sampledAt ?? 0) || 0;
      if (playing) {
        if (anchorAt > 0) progressMs = Math.max(0, now - anchorAt);
        else if (sampledAt > 0) progressMs += Math.max(0, now - sampledAt);
      }
      if (durationMs > 0) progressMs = Math.min(Math.max(0, progressMs), durationMs);
      return {
        title: String(value.title || '').trim(),
        artist: String(value.artist || '').trim(),
        artwork: String(value.artwork || '').trim(),
        durationMs,
        progressMs,
        playing,
        hasTrack: value.hasTrack === true || Boolean(value.title),
      };
    }

    const playing = value.playing === true || (value.is_broadcasting === true && value.is_paused !== true);
    const sampledAt = Number(value.sampledAt ?? value.monitorSampledAt ?? value.updatedAt ?? 0) || 0;
    const anchorAt = Number(value.anchorAt ?? 0) || 0;
    let itemSource = value.item || value.currentItem || value.currentTrack || value.track || {};
    let durationMs = Math.max(0, Number(value.durationMs ?? value.trackDurationMs ?? asObject(itemSource).durationMs ?? 0) || 0);
    let progressMs = Math.max(0, Number(value.progressMs ?? value.positionMs ?? 0) || 0);
    const queue = queueFrom(value);

    if (queue.length) {
      let index = Number(value.currentIndex ?? value.current_index ?? value.queue_status?.current_index ?? -1);
      if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
        index = queue.findIndex(item => item?.is_current === true);
      }
      if (!Number.isInteger(index) || index < 0 || index >= queue.length) index = 0;
      let elapsed = progressMs;
      if (playing) {
        if (anchorAt > 0) elapsed = Math.max(0, now - anchorAt);
        else if (sampledAt > 0) elapsed += Math.max(0, now - sampledAt);
      }
      while (index < queue.length) {
        const queueItem = normalizedItem(queue[index]);
        if (!playing || queueItem.durationMs <= 0 || elapsed < queueItem.durationMs + TRACK_TRANSITION_HOLD_MS) break;
        elapsed -= queueItem.durationMs;
        index += 1;
      }
      if (index < queue.length) {
        itemSource = queue[index];
        const queueItem = normalizedItem(itemSource);
        durationMs = queueItem.durationMs;
        progressMs = Math.min(queueItem.durationMs, Math.max(0, elapsed));
      } else {
        itemSource = {};
        durationMs = 0;
        progressMs = 0;
      }
    } else {
      const expectedEndAt = Number(value.expectedEndAt ?? 0) || 0;
      if (durationMs > 0 && expectedEndAt > 0) {
        progressMs = durationMs - Math.max(0, expectedEndAt + TRACK_TRANSITION_HOLD_MS - now);
      } else if (playing && sampledAt > 0) {
        progressMs += Math.max(0, now - sampledAt);
      }
    }

    const item = normalizedItem(itemSource);
    if (!durationMs) durationMs = item.durationMs;
    if (durationMs > 0) progressMs = Math.min(Math.max(0, progressMs), durationMs);
    return {
      title: item.name,
      artist: item.artist,
      artwork: item.artwork,
      durationMs,
      progressMs,
      playing,
      hasTrack: Boolean(item.name),
    };
  }

  function renderProgress(prefix, snapshot) {
    const root = ensureProgress(prefix);
    if (!root) return;
    root.hidden = !(snapshot.hasTrack && snapshot.durationMs > 0);
    if (root.hidden) return;
    const ratio = Math.max(0, Math.min(1, snapshot.progressMs / snapshot.durationMs));
    const fill = $(`#${prefix}-progress-fill`);
    if (fill) {
      fill.style.display = 'block';
      fill.style.width = '100%';
      fill.style.margin = '0';
      fill.style.transformOrigin = 'left center';
      fill.style.transform = `scaleX(${ratio.toFixed(4)})`;
      fill.style.transition = 'transform .25s linear';
    }
    setText(`#${prefix}-progress-current`, formatTime(snapshot.progressMs));
    setText(`#${prefix}-progress-duration`, formatTime(snapshot.durationMs));
  }

  function sourceStatus(source, snapshot, now = Date.now()) {
    const stale = source.fetchedAt <= 0 || now - source.fetchedAt > PLAYBACK_STALE_MS;
    if (source.error && stale) return { kind: 'stale', detail: `${source.error}` };
    if (source.error) return { kind: 'offline', detail: `${source.error}` };
    if (stale) return { kind: 'stale', detail: 'native譖ｴ譁ｰ蠕・■' };
    if (snapshot.playing && snapshot.hasTrack) return { kind: 'live', detail: '' };
    if (snapshot.hasTrack) return { kind: 'paused', detail: '蛛懈ｭ｢荳ｭ' };
    return { kind: 'offline', detail: '諠・ｱ蠕・■' };
  }

  function renderStationheadPlayer({ source, snapshot, status }) {
    setText(`#${source.prefix}-track`, snapshot.title || `${source.channel}譖ｲ諠・ｱ蠕・■`);
    setText(`#${source.prefix}-artist`, snapshot.artist || '--');
    setArtwork(`#${source.prefix}-artwork`, `#${source.prefix}-artwork-fallback`, snapshot.artwork);
    renderProgress(source.prefix, snapshot);
    setBadge(source.prefix, status.kind, status.detail);
    updateAudioControls(source === PLAYBACK_SOURCES.b ? 'b' : 'a');
  }

  function renderPlayers() {
    const snapshots = currentSnapshots();
    for (const key of PLAYBACK_SOURCE_KEYS) {
      const snapshot = snapshots[key];
      renderStationheadPlayer({
        source: PLAYBACK_SOURCES[key],
        snapshot,
        status: sourceStatus(playbackStates[key], snapshot),
      });
    }
  }

  function currentSnapshots() {
    const cacheKey = JSON.stringify([
      ...PLAYBACK_SOURCE_KEYS.flatMap(key => [
        playbackStates[key].revision,
        playbackStates[key].fetchedAt,
      ]),
      Math.floor(Date.now() / 1000),
    ]);
    if (snapshotCache.key === cacheKey &&
        PLAYBACK_SOURCE_KEYS.every(key => Boolean(snapshotCache[key]))) return snapshotCache;
    snapshotCache.key = cacheKey;
    for (const key of PLAYBACK_SOURCE_KEYS) {
      snapshotCache[key] = playbackSnapshot(playbackStates[key].value);
    }
    return snapshotCache;
  }

  function hasActiveProgress() {
    const snapshots = currentSnapshots();
    return PLAYBACK_SOURCE_KEYS.some(key => {
      const snapshot = snapshots[key];
      return snapshot.hasTrack && snapshot.durationMs > 0;
    });
  }

  function renderAll() {
    removePanelHeaderMeta();
    renderPlugs(dashboard.switchbot || {});
    renderPlayers();
  }

  function applyNativePlayback(message) {
    const key = String(message?.source || '').toLowerCase();
    if (!playbackStates[key]) return;
    playbackStates[key].fetchedAt = Number(message.fetchedAt) || Date.now();
    playbackStates[key].error = String(message.error || '');
    playbackStates[key].revision += 1;
    playbackStates[key].value = message.resolved && typeof message.resolved === 'object'
      ? message.resolved
      : message.payload && typeof message.payload === 'object'
        ? normalizePlaybackPayload(unwrapPlaybackPayload(message.payload), playbackStates[key].fetchedAt)
        : {};
    renderAll();
  }

  function applyState(state) {
    const incoming = state || {};
    if (incoming.dashboard) dashboard = incoming.dashboard;
    syncAudioControlsFromRuntime(incoming);
    renderAll();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderAll();
  });
  window.addEventListener('homepanel-second', () => {
    if (document.hidden || !hasActiveProgress()) return;
    renderPlayers();
  });
  window.chrome?.webview?.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type === 'native-playback') applyNativePlayback(message);
    else applyState(message);
  });

  removePanelHeaderMeta();
  installAudioControlHandlers();
  renderAll();
})();
