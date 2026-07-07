#pragma once

namespace hp {
namespace {

constexpr wchar_t kSecondaryObserverRetentionGuard[] = LR"HPJS(
(() => {
  'use strict';
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  if (window.__homepanelSecondaryObserverRetentionGuard) return;

  const playback = window.__homepanelSecondaryPlaybackOnly;
  const retained = new Set();

  const unwrapNativeObserver = WrappedObserver => {
    if (!WrappedObserver) return undefined;
    try {
      const probe = new WrappedObserver(() => {});
      const nativeObserver = probe?.nativeObserver;
      const NativeObserver = nativeObserver
        ? Object.getPrototypeOf(nativeObserver)?.constructor || nativeObserver.constructor
        : WrappedObserver;
      try { probe?.disconnect?.(); } catch (_) {}
      return NativeObserver || WrappedObserver;
    } catch (_) {
      return WrappedObserver;
    }
  };

  const guard = WrappedObserver => {
    const NativeObserver = unwrapNativeObserver(WrappedObserver);
    if (!NativeObserver) return undefined;
    const GuardedObserver = function(...args) {
      const observer = new NativeObserver(...args);
      const entry = { observer };
      retained.add(entry);
      try {
        const disconnect = observer.disconnect?.bind(observer);
        if (disconnect) {
          observer.disconnect = () => {
            retained.delete(entry);
            return disconnect();
          };
        }
      } catch (_) {}
      if (playback?.frozen) {
        try { observer.disconnect?.(); } catch (_) {}
        retained.delete(entry);
      }
      return observer;
    };
    Object.setPrototypeOf(GuardedObserver, NativeObserver);
    GuardedObserver.prototype = NativeObserver.prototype;
    return GuardedObserver;
  };

  if (playback?.freeze) {
    const baseFreeze = playback.freeze.bind(playback);
    playback.freeze = () => {
      for (const entry of Array.from(retained)) {
        try { entry.observer.disconnect?.(); } catch (_) {}
      }
      retained.clear();
      return baseFreeze();
    };
  }

  window.MutationObserver = guard(window.MutationObserver);
  window.ResizeObserver = guard(window.ResizeObserver);
  window.IntersectionObserver = guard(window.IntersectionObserver);
  window.PerformanceObserver = guard(window.PerformanceObserver);
  window.__homepanelSecondaryObserverRetentionGuard = true;
})()
)HPJS";

}  // namespace
}  // namespace hp
