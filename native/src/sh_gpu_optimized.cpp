#include "stationhead_optimized.cpp"

namespace hp {
namespace {
constexpr wchar_t kStationheadGpuRuntimePostlude[] = LR"HPJS(
(() => {
  'use strict';

  const patch = window.__homepanelStationheadPatch;
  const perf = window.__homepanelPerfNative;
  if (!patch || !perf || window.__homepanelGpuRuntime) return;

  const native = perf.native;
  const criticalWork = /audio|media|player|playback|stream|hls|dash|webrtc|rtc|heartbeat|keep.?alive|ping|socket|websocket|reconnect|peer|ice|pusher|centrif|pubnub|track|song|station|volume|progress|buffer/i;
  const timers = new Map();
  const webglContexts = new Set();
  const pausedVideos = new Set();
  let nextTimerId = 0x61000000;
  let frozen = Boolean(patch.frozen);

  const sourceOf = callback => {
    try {
      return `${typeof callback === 'function' ? Function.prototype.toString.call(callback) : String(callback)}\n${new Error().stack || ''}`;
    } catch (_) {
      return '';
    }
  };

  const criticalTimer = record => record.delay >= 10000 || criticalWork.test(record.source);

  const invoke = record => {
    if (typeof record.callback === 'function') return record.callback.apply(window, record.args);
    return (0, eval)(String(record.callback));
  };

  const clearNative = record => {
    if (!record.nativeId) return;
    if (record.kind === 'interval') native.clearInterval(record.nativeId);
    else native.clearTimeout(record.nativeId);
    record.nativeId = 0;
  };

  const run = record => {
    if (!record.active) return;
    record.runs += 1;
    record.lastRunAt = Date.now();
    if (record.kind === 'timeout') {
      record.active = false;
      timers.delete(record.id);
    }
    invoke(record);
  };

  const arm = (record, delay = record.delay) => {
    if (!record.active || record.nativeId || (frozen && !criticalTimer(record))) return;
    if (record.kind === 'interval') {
      record.nativeId = native.interval(() => run(record), Math.max(1, record.delay));
    } else {
      const wait = Math.max(0, Number(delay) || 0);
      record.dueAt = Date.now() + wait;
      record.nativeId = native.timeout(() => {
        record.nativeId = 0;
        run(record);
      }, wait);
    }
  };

  const pause = record => {
    if (!record.active || !record.nativeId || criticalTimer(record)) return;
    if (record.kind === 'timeout') record.remaining = Math.max(0, record.dueAt - Date.now());
    clearNative(record);
    record.paused = true;
  };

  const resume = record => {
    if (!record.active || !record.paused) return;
    record.paused = false;
    arm(record, record.kind === 'timeout' ? record.remaining : record.delay);
  };

  const createTimer = (kind, callback, delay, args) => {
    const record = {
      id: nextTimerId++, kind, callback, args,
      delay: Math.max(0, Number(delay) || 0),
      source: sourceOf(callback), active: true, paused: false,
      nativeId: 0, dueAt: 0, remaining: Math.max(0, Number(delay) || 0),
      runs: 0, lastRunAt: 0,
    };
    timers.set(record.id, record);
    if (frozen && !criticalTimer(record)) record.paused = true;
    else arm(record);
    return record.id;
  };

  const clearTimer = (id, kind) => {
    const record = timers.get(id);
    if (!record) {
      return kind === 'interval' ? native.clearInterval(id) : native.clearTimeout(id);
    }
    record.active = false;
    clearNative(record);
    timers.delete(id);
  };

  window.setInterval = (callback, delay, ...args) => createTimer('interval', callback, delay, args);
  window.setTimeout = (callback, delay, ...args) => createTimer('timeout', callback, delay, args);
  window.clearInterval = id => clearTimer(id, 'interval');
  window.clearTimeout = id => clearTimer(id, 'timeout');

  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function(type, ...args) {
    const kind = String(type || '').toLowerCase();
    const webgl = kind === 'webgl' || kind === 'webgl2' || kind === 'experimental-webgl';
    if (frozen && webgl && !this.closest?.('audio,video')) return null;
    const context = nativeGetContext.call(this, type, ...args);
    if (context && webgl) webglContexts.add({ canvas: this, context });
    return context;
  };

  const nativeRequestVideoFrame = HTMLVideoElement.prototype.requestVideoFrameCallback;
  if (nativeRequestVideoFrame) {
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
      if (frozen && (this.muted || this.volume === 0)) return 0;
      return nativeRequestVideoFrame.call(this, callback);
    };
  }

  const suspendVisualMedia = () => {
    for (const entry of Array.from(webglContexts)) {
      if (!entry.canvas?.isConnected) {
        webglContexts.delete(entry);
        continue;
      }
      if (entry.canvas.closest?.('audio,video')) continue;
      try { entry.context.getExtension?.('WEBGL_lose_context')?.loseContext?.(); } catch (_) {}
    }
    for (const video of document.querySelectorAll?.('video') || []) {
      if (!(video.muted || video.volume === 0 || (video.autoplay && video.loop))) continue;
      if (!video.paused && !video.ended) {
        pausedVideos.add(video);
        try { video.pause(); } catch (_) {}
      }
    }
  };

  const restoreVisualMedia = () => {
    for (const entry of Array.from(webglContexts)) {
      try { entry.context.getExtension?.('WEBGL_lose_context')?.restoreContext?.(); } catch (_) {}
    }
    for (const video of Array.from(pausedVideos)) {
      pausedVideos.delete(video);
      if (!video.isConnected) continue;
      try { video.play()?.catch?.(() => {}); } catch (_) {}
    }
  };

  const timerStats = () => {
    let paused = 0;
    let critical = 0;
    let active = 0;
    for (const record of timers.values()) {
      if (record.paused) ++paused;
      if (criticalTimer(record)) ++critical;
      if (record.nativeId) ++active;
    }
    return { total: timers.size, active, paused, critical };
  };

  const baseFreeze = patch.freeze.bind(patch);
  const baseUnfreeze = patch.unfreeze.bind(patch);
  patch.freeze = () => {
    if (frozen) return;
    frozen = true;
    for (const record of timers.values()) pause(record);
    suspendVisualMedia();
    baseFreeze();
  };
  patch.unfreeze = () => {
    if (!frozen) return;
    baseUnfreeze();
    frozen = false;
    restoreVisualMedia();
    for (const record of timers.values()) resume(record);
  };

  window.__homepanelGpuRuntime = {
    get frozen() { return frozen; },
    timerStats,
    get webglContextCount() { return webglContexts.size; },
    get pausedVideoCount() { return pausedVideos.size; },
  };
})();
)HPJS";

std::wstring BuildStationheadGpuPatch() {
  std::wstring combined(kStationheadAppPatch);
  combined.push_back(L'\n');
  combined.append(kStationheadGpuRuntimePostlude);
  return combined;
}

const std::wstring kCombinedStationheadGpuPatch = BuildStationheadGpuPatch();

struct StationheadGpuPatchInstaller {
  StationheadGpuPatchInstaller() {
    kStationheadAppPatch = kCombinedStationheadGpuPatch.c_str();
  }
};

StationheadGpuPatchInstaller stationheadGpuPatchInstaller;
}  // namespace
}  // namespace hp
