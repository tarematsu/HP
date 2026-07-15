#pragma once

// Keep the shared helpers available, but replace the policy-sensitive helpers
// with native-application implementations.
#define StationheadAutoplayScript StationheadAutoplayScriptBase
#define StationheadApiPlayStatsScript StationheadApiPlayStatsScriptUnthrottled
#define StationheadAuthProbeScript StationheadAuthProbeScriptNetwork
#include "sh_shared.h"
#undef StationheadAuthProbeScript
#undef StationheadApiPlayStatsScript
#undef StationheadAutoplayScript

namespace hp {

// Pusher carries both track transitions and live social traffic. The socket
// must remain connected for immediate next-track playback, so remove the
// non-playback presentation surfaces from the DOM instead. This script runs at
// document creation for both Stationhead windows, before the first page paint,
// and keeps suppressing React-rendered replacements without touching login,
// Start Listening, Spotify authorization, or audio/video elements.
inline std::wstring StationheadAudioOnlyUiScript() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  if (window.__homepanelStationheadAudioOnlyUi) return;
  window.__homepanelStationheadAudioOnlyUi = true;

  const hiddenAttribute = 'data-homepanel-audio-only-hidden';
  const styleId = 'homepanel-stationhead-audio-only';
  const safeSelector = [
    '[data-testid*="chat" i]', '[id*="chat" i]', '[aria-label*="chat" i]',
    '[data-testid*="comment" i]', '[id*="comment" i]', '[aria-label*="comment" i]',
    '[data-testid*="gift" i]', '[id*="gift" i]', '[aria-label*="gift" i]',
    '[data-testid*="tipping" i]', '[id*="tipping" i]', '[aria-label*="tipping" i]',
    '[data-testid*="trending" i]', '[id*="trending" i]', '[aria-label*="trending" i]',
    '[data-testid*="thread" i]', '[id*="thread" i]', '[aria-label*="thread" i]',
    '[data-testid*="reaction" i]', '[id*="reaction" i]', '[aria-label*="reaction" i]',
    '[data-testid*="emoji" i]', '[id*="emoji" i]', '[aria-label*="emoji" i]',
    'a[href*="/chat" i]', 'a[href*="/gift" i]', 'a[href*="/thread" i]'
  ].join(',');
  const auxiliarySelector = [
    '[data-testid*="listener" i]', '[id*="listener" i]', '[aria-label*="listener" i]',
    '[data-testid*="audience" i]', '[id*="audience" i]', '[aria-label*="audience" i]'
  ].join(',');
  const labelSelector = 'button,[role="button"],[role="tab"],h1,h2,h3,[aria-label],[data-testid]';
  const nonPlaybackPattern = /\b(chat|comments?|listeners?|audience|gifts?|tipping|trending|threads?|reactions?|emoji)\b|チャット|コメント|リスナー|視聴者|ギフト|投げ銭|トレンド|スレッド|リアクション|絵文字/i;
  const protectedPattern = /\b(start listening|listen now|join station|join room|resume|continue|play|pause|volume|mute|spotify|log in|sign in|login|connect)\b|視聴を開始|再生|一時停止|音量|ミュート|ログイン|接続|続ける/i;
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const labelOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.innerText,
    element?.textContent,
  ].filter(Boolean).join(' '));
  const protectedNode = element => {
    if (!(element instanceof Element)) return true;
    if (element.matches('audio,video') || element.querySelector?.('audio,video')) return true;
    return protectedPattern.test(labelOf(element));
  };
  const hide = (element, expand = false) => {
    if (!(element instanceof Element) || protectedNode(element)) return;
    let target = element;
    if (expand) {
      const container = element.closest?.('aside,[role="tabpanel"],[role="dialog"]');
      if (container && container !== document.body && container !== document.documentElement &&
          !protectedNode(container)) {
        target = container;
      }
    }
    const tag = String(target.tagName || '').toLowerCase();
    if (target === document.body || target === document.documentElement || tag === 'main') return;
    target.setAttribute(hiddenAttribute, 'true');
  };
  const matching = (root, selector) => {
    const output = [];
    if (root instanceof Element && root.matches(selector)) output.push(root);
    for (const element of root?.querySelectorAll?.(selector) || []) output.push(element);
    return output;
  };
  const scan = root => {
    for (const element of matching(root, safeSelector)) hide(element, true);
    for (const element of matching(root, auxiliarySelector)) hide(element, false);
    for (const element of matching(root, labelSelector)) {
      const label = labelOf(element);
      if (!label || protectedPattern.test(label) || !nonPlaybackPattern.test(label)) continue;
      hide(element, element.matches('h1,h2,h3,[role="tab"]'));
    }
  };
  const installStyle = () => {
    if (document.getElementById(styleId)) return true;
    const root = document.head || document.documentElement;
    if (!root) return false;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `${safeSelector},[${hiddenAttribute}="true"]{display:none!important;visibility:hidden!important;pointer-events:none!important;content-visibility:hidden!important;contain:strict!important}`;
    root.appendChild(style);
    return true;
  };
  const pending = new Set();
  let queued = false;
  const flush = () => {
    queued = false;
    for (const root of pending) scan(root);
    pending.clear();
  };
  const schedule = root => {
    if (root) pending.add(root);
    if (queued) return;
    queued = true;
    Promise.resolve().then(flush);
  };
  const start = () => {
    if (!document.documentElement) return;
    installStyle();
    scan(document);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'characterData') {
          schedule(record.target?.parentElement);
          continue;
        }
        schedule(record.target);
        for (const node of record.addedNodes || []) schedule(node);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['id', 'data-testid', 'aria-label', 'role', 'href'],
    });
    window.__homepanelStationheadAudioOnlyUiObserver = observer;
  };
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})()
)JS";
  return kScript;
}

inline std::wstring StationheadAutoplayScript(const wchar_t* globalName,
                                              const wchar_t* messagePrefix) {
  std::wstring script = StationheadAudioOnlyUiScript();
  script.push_back(L'\n');
  script.append(StationheadAutoplayScriptBase(globalName, messagePrefix));
  return script;
}

// Window A may ask for stats more frequently while recovering authentication,
// but a successful authenticated request is followed by a ten-minute quiet
// period. Failed/no-header attempts keep the existing short retry behavior.
inline std::wstring StationheadApiPlayStatsScript(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const headers = window.__homepanelStationheadAuthHeaders;
  if (!headers?.authorization) {
    post({ type: 'stationhead-play-stats-error', error: 'no-auth-header' });
    return false;
  }
  const lastSuccessAt = Number(window.__homepanelStationheadPlayStatsSuccessAt || 0);
  if (lastSuccessAt > 0 && Date.now() - lastSuccessAt < 10 * 60 * 1000) {
    return false;
  }
  const url = 'https://production1.stationhead.com/me/channel/)JS"
         << channelId << LR"JS(/streakStats';
  fetch(url, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    headers: Object.assign({ accept: 'application/json' }, headers),
  }).then(async response => {
    if (response.status === 401 || response.status === 403) {
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      window.__homepanelStationheadAuthHeaders = null;
      post({ type: 'stationhead-play-stats-auth-failed', status: response.status });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (data) {
      window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
      post({ type: 'stationhead-play-stats', data, source: 'authenticated-api' });
    }
  }).catch(error => {
    post({ type: 'stationhead-play-stats-error', error: String(error?.message || error) });
  });
  return true;
})()
)JS";
  return script.str();
}

// Window B must not make an extra logged-in API request. Its periodic probe now
// inspects only the authorization header already observed from the page's own
// traffic and immediately reports that local state to the native handler.
inline std::wstring StationheadAuthProbeScript(int channelId) {
  (void)channelId;
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const authorized = Boolean(window.__homepanelStationheadAuthHeaders?.authorization);
  post({ type: 'stationhead-auth-probe', state: authorized ? 'ok' : 'no-auth-header' });
  return authorized;
})()
)JS";
  return kScript;
}

}  // namespace hp
