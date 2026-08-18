#pragma once

namespace hp {

// A sparse dark Stationhead page is recoverable only when it has no legitimate
// account or playback interaction. Stop all document-owned timers on pagehide so
// a discarded document cannot reload a newer navigation.
inline std::wstring StationheadBlankPageRecoveryScriptRuntimeFixed() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return;
  if (window.__homepanelStationheadBlankRecoveryFixed) return;
  window.__homepanelStationheadBlankRecoveryFixed = true;

  const nativeSetInterval = window.setInterval.bind(window);
  const nativeClearInterval = window.clearInterval.bind(window);
  const nativeSetTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const observedAt = Date.now();
  const reloadKey = '__homepanelStationheadBlankReloadAt';
  const interactiveSelector = "button,[role='button'],a,input,select,textarea,[tabindex],[aria-label],[data-testid]";
  const credentialSelector = "input[type='password'],input[type='email'],input[autocomplete='username'],input[autocomplete='current-password']";
  const protectedPattern = /\b(start listening|listen now|listen live|join station|join room|resume|continue|play|pause|spotify|connect spotify|log in|sign in|login)\b|視聴を開始|再生|一時停止|続ける|続行|次へ|ログイン|サインイン|接続/i;
  let pageActive = true;
  let blankSince = 0;
  let interval = 0;
  let reloadTimer = 0;
  let loadCheckTimer = 0;

  const playing = () => {
    if (typeof window.__homepanelAudioPlaying === 'boolean') {
      return window.__homepanelAudioPlaying;
    }
    if (navigator.mediaSession?.playbackState === 'playing') return true;
    return Array.from(document.querySelectorAll('audio,video')).some(element =>
      !element.paused && !element.ended && element.readyState >= 2);
  };
  const visible = element => {
    if (!(element instanceof Element) || !element.isConnected ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2 || rect.right <= 0 ||
        rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) {
      return false;
    }
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0;
  };
  const labelOf = element => normalize([
    element?.getAttribute?.('aria-label'),
    element?.getAttribute?.('data-testid'),
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value'),
    element?.innerText,
    element?.textContent,
  ].filter(Boolean).join(' '));
  const protectedInteractionVisible = () => {
    if (window.__homepanelStationheadBlockingLoginVisible === true) return true;
    if (/(^|\/)(login|signin|sign-in|auth)(\/|$)/i.test(
          String(location.pathname || ''))) {
      return true;
    }
    for (const element of document.querySelectorAll(credentialSelector)) {
      if (visible(element)) return true;
    }
    for (const element of document.querySelectorAll(interactiveSelector)) {
      if (visible(element) && protectedPattern.test(labelOf(element))) return true;
    }
    return false;
  };
  const clippedArea = rect => {
    const width = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
    const height = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
    return width * height;
  };
  const darkColor = value => {
    const match = String(value || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
    if (!match) return null;
    const alpha = match[4] === undefined ? 1 : Number(match[4]);
    if (!Number.isFinite(alpha) || alpha <= 0.05) return null;
    return Math.max(Number(match[1]), Number(match[2]), Number(match[3])) <= 32;
  };
  const pointIsDark = (x, y) => {
    let element = document.elementFromPoint(x, y);
    for (let depth = 0; element && depth < 12; ++depth, element = element.parentElement) {
      if (element.matches?.('img,video,canvas,picture,iframe,svg')) return false;
      const style = getComputedStyle(element);
      if (style.backgroundImage && style.backgroundImage !== 'none') return false;
      const dark = darkColor(style.backgroundColor);
      if (dark !== null) return dark;
    }
    return true;
  };
  const sparseDarkSurface = () => {
    if (!pageActive || document.visibilityState === 'hidden' ||
        document.readyState !== 'complete' || !document.body ||
        innerWidth < 100 || innerHeight < 100 || playing() ||
        protectedInteractionVisible()) {
      return false;
    }
    if (normalize(document.body.innerText).length >= 320) return false;

    let interactiveCount = 0;
    for (const element of document.querySelectorAll(interactiveSelector)) {
      if (!visible(element) || clippedArea(element.getBoundingClientRect()) < 400) continue;
      if (++interactiveCount > 5) return false;
    }

    const viewportArea = innerWidth * innerHeight;
    let mediaArea = 0;
    for (const element of document.querySelectorAll('img,video,canvas,iframe,svg')) {
      if (!visible(element)) continue;
      mediaArea += clippedArea(element.getBoundingClientRect());
      if (mediaArea >= viewportArea * 0.20) return false;
    }

    let darkPoints = 0;
    let sampledPoints = 0;
    for (const yRatio of [0.20, 0.35, 0.50, 0.65, 0.80]) {
      for (const xRatio of [0.10, 0.30, 0.50, 0.70, 0.90]) {
        ++sampledPoints;
        if (pointIsDark(innerWidth * xRatio, innerHeight * yRatio)) ++darkPoints;
      }
    }
    return sampledPoints > 0 && darkPoints / sampledPoints >= 0.80;
  };
  const readLastReloadAt = () => {
    try { return Number(sessionStorage.getItem(reloadKey) || 0); } catch (_) { return 0; }
  };
  const writeLastReloadAt = now => {
    try { sessionStorage.setItem(reloadKey, String(now)); } catch (_) {}
  };
  const clearReloadAt = () => {
    try { sessionStorage.removeItem(reloadKey); } catch (_) {}
  };
  const cancelReload = () => {
    if (!reloadTimer) return;
    nativeClearTimeout(reloadTimer);
    reloadTimer = 0;
  };
  const check = () => {
    if (!pageActive) return;
    const now = Date.now();
    if (playing() || protectedInteractionVisible()) {
      blankSince = 0;
      cancelReload();
      if (playing()) clearReloadAt();
      return;
    }
    if (now - observedAt < 30000 || !sparseDarkSurface()) {
      blankSince = 0;
      cancelReload();
      return;
    }
    if (!blankSince) {
      blankSince = now;
      return;
    }
    if (now - blankSince < 15000 || reloadTimer) return;
    const lastReloadAt = readLastReloadAt();
    if (lastReloadAt > 0 && now - lastReloadAt < 120000) {
      blankSince = now;
      return;
    }
    writeLastReloadAt(now);
    reloadTimer = nativeSetTimeout(() => {
      reloadTimer = 0;
      if (pageActive && !playing() && !protectedInteractionVisible() &&
          sparseDarkSurface()) {
        location.reload();
      }
    }, 50);
  };
  const start = () => {
    if (!pageActive || interval) return;
    interval = nativeSetInterval(check, 5000);
  };
  const stop = () => {
    pageActive = false;
    blankSince = 0;
    if (interval) {
      nativeClearInterval(interval);
      interval = 0;
    }
    cancelReload();
    if (loadCheckTimer) {
      nativeClearTimeout(loadCheckTimer);
      loadCheckTimer = 0;
    }
  };

  window.addEventListener('pagehide', stop, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    start();
    check();
  }, true);
  window.addEventListener('load', () => {
    loadCheckTimer = nativeSetTimeout(() => {
      loadCheckTimer = 0;
      if (pageActive) check();
    }, 30000);
  }, { once: true });
  start();
})()
)JS";
  return kScript;
}

// Locate only a genuine playback control. Account, consent, Spotify, and login
// surfaces can contain generic Continue buttons and must never receive an
// automated native click.
inline std::wstring StationheadLocateStartButtonScriptRuntimeFixed() {
  static constexpr wchar_t kScript[] = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return null;
  const startPattern = /\b(start|join|resume|continue)\s+(listening|station|show|room)\b|\blisten\s+(now|live)\b|^(continue|let(?:'|’)?s\s+go|続ける|続行|次へ)$/i;
  const accountPattern = /\b(log\s*in|sign\s*in|login|spotify|connect|authorize|consent|account|password|email)\b|ログイン|サインイン|認証|接続|同意|アカウント|パスワード/i;
  const credentialSelector = "input[type='password'],input[type='email'],input[autocomplete='username'],input[autocomplete='current-password']";
  const selector = "button,[role='button'],a,input[type='button'],input[type='submit'],[aria-label],[data-testid],[tabindex]";
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const labelOf = element => normalize([
    element?.innerText,
    element?.getAttribute?.('aria-label'),
    element?.textContent,
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value'),
    element?.getAttribute?.('data-testid'),
  ].filter(Boolean).join(' '));
  const visible = element => {
    if (!(element instanceof HTMLElement) || !element.isConnected || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 2 || rect.height <= 2 || rect.right <= 0 ||
        rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) {
      return false;
    }
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 && style.pointerEvents !== 'none';
  };
  const playing = () => {
    if (typeof window.__homepanelAudioPlaying === 'boolean') {
      return window.__homepanelAudioPlaying;
    }
    if (navigator.mediaSession?.playbackState === 'playing') return true;
    return Array.from(document.querySelectorAll('audio,video')).some(element =>
      !element.paused && !element.ended && element.readyState >= 2);
  };
  const accountInteractionVisible = () => {
    if (window.__homepanelStationheadBlockingLoginVisible === true ||
        /(^|\/)(login|signin|sign-in|auth)(\/|$)/i.test(
          String(location.pathname || ''))) {
      return true;
    }
    for (const element of document.querySelectorAll(credentialSelector)) {
      if (visible(element)) return true;
    }
    for (const element of document.querySelectorAll(selector)) {
      if (!visible(element) || !accountPattern.test(labelOf(element))) continue;
      if (element.closest?.("form,[role='dialog'],[aria-modal='true'],[data-testid*='auth' i],[data-testid*='login' i],[id*='auth' i],[id*='login' i]")) {
        return true;
      }
    }
    return false;
  };
  if (!document.body || playing() || accountInteractionVisible()) return null;

  for (const element of document.querySelectorAll(selector)) {
    if (!visible(element) || !startPattern.test(labelOf(element))) continue;
    if (element.matches('audio,video') || element.querySelector?.('audio,video')) continue;
    const href = String(element.getAttribute?.('href') || '').toLowerCase();
    if (/(^|\/)(login|signin|sign-in|auth|account|settings)(\/|$)|spotify|authorize|consent/.test(href)) {
      continue;
    }
    const shell = element.closest?.("form,[role='dialog'],[aria-modal='true']");
    if (shell && (shell.querySelector?.(credentialSelector) || accountPattern.test(labelOf(shell)))) {
      continue;
    }
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== element && !element.contains(hit))) continue;
    return { x, y };
  }
  return null;
})()
)JS";
  return kScript;
}

// The base resource callback captured a reference to a StationheadPlayer member
// even though it did not use the value. Keep the same blocking policy without a
// player-lifetime capture so delayed callbacks from a closing WebView are inert.
inline void ApplyStationheadResourceBlockingRuntimeFixed(
    ICoreWebView2Environment* environment,
    ICoreWebView2* webview,
    const StationheadConfig& config,
    std::atomic<bool>& armed,
    EventRegistrationToken& token) {
  (void)armed;
  if (!environment || !webview) return;
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_STYLESHEET);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_SCRIPT);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_XML_HTTP_REQUEST);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_EVENT_SOURCE);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_PING);
  webview->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT);

  const bool blockImages = config.blockImages;
  const bool blockFonts = config.blockFonts;
  ComPtr<ICoreWebView2Environment> env = environment;
  webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [env, blockImages, blockFonts](
              ICoreWebView2*,
              ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT {
            if (!args) return S_OK;
            COREWEBVIEW2_WEB_RESOURCE_CONTEXT context =
                COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
            const bool hasContext = SUCCEEDED(args->get_ResourceContext(&context));
            bool block = false;
            bool needsUri = true;
            if (hasContext) {
              if ((blockImages && context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE) ||
                  (blockFonts && context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT) ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_TEXT_TRACK ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MANIFEST ||
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_CSP_VIOLATION_REPORT) {
                block = true;
                needsUri = false;
              }
            }
            if (needsUri) {
              std::wstring lower;
              ComPtr<ICoreWebView2WebResourceRequest> request;
              if (SUCCEEDED(args->get_Request(&request)) && request) {
                LPWSTR uriRaw = nullptr;
                if (SUCCEEDED(request->get_Uri(&uriRaw)) && uriRaw) {
                  lower = StationheadLowerAscii(uriRaw);
                  CoTaskMemFree(uriRaw);
                }
              }
              block = StationheadRequestIsBlockable(lower);
              if (!block && blockImages && StationheadRequestLooksLikeImage(lower)) {
                block = true;
              }
              if (!block && hasContext &&
                  context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_MEDIA) {
                block = !lower.empty() && !StationheadCorePlaybackRequest(lower);
              }
            }
            if (block) {
              ComPtr<ICoreWebView2WebResourceResponse> response;
              if (SUCCEEDED(env->CreateWebResourceResponse(
                      nullptr, 403, L"Blocked", L"", &response))) {
                args->put_Response(response.Get());
              }
            }
            return S_OK;
          }).Get(),
      &token);
  BlockStationheadTelemetrySockets(webview, config.blockImages);
  ApplyStationheadNonPlaybackScriptBlocking(environment, webview);
  ApplyStationheadAdditionalScriptBlocking(environment, webview);
}

// Install login/auth detection before the other document-start policies. It is
// self-contained and owns its own timer, so a later optional UI/recovery script
// cannot prevent an already-installed login foreground detector from running.
inline std::wstring StationheadAutoplayScriptRuntimeFixed(
    const wchar_t* globalName, const wchar_t* messagePrefix) {
  std::wostringstream extension;
  extension << LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  const webview = window.chrome?.webview;
  const nativePost = webview?.postMessage?.bind(webview);
  const topLevelStationhead =
    (host === 'stationhead.com' || host.endsWith('.stationhead.com')) &&
    window.top === window;
  if (!topLevelStationhead) {
    // AddScriptToExecuteOnDocumentCreated also runs in child frames and after an
    // external top-level navigation. Remove the page-to-native channel before
    // either document can emit Stationhead-shaped state messages.
    if (webview && nativePost) {
      const blockedPost = () => undefined;
      try { webview.postMessage = blockedPost; } catch (_) {}
      try {
        Object.defineProperty(webview, 'postMessage', {
          configurable: false,
          writable: false,
          value: blockedPost,
        });
      } catch (_) {}
    }
    return;
  }
  if (window.)JS"
            << globalName
            << LR"JS(AuthRecheck) return;
  window.)JS"
            << globalName
            << LR"JS(AuthRecheck = true;
  const nativeTimeout = window.setTimeout.bind(window);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const selector = "button,[role='button'],a,input[type='button'],input[type='submit'],[aria-label],[data-testid],[tabindex]";
  const credentialSelector = "input[type='password'],input[type='email'],input[autocomplete='username'],input[autocomplete='current-password']";
  const authHeadingSelector = "h1,h2,h3,[role='heading']";
  const loginPattern = /^(log\s*in|sign\s*in|login|ログイン|サインイン)(?:\s+.*)?$/i;
  const serviceConnectPattern = /^connect\s+music$/i;
  const visible = element => {
    if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true' ||
        element.getAttribute?.('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0 && style.pointerEvents !== 'none';
  };
  const labelOf = element => [
    element?.innerText,
    element?.getAttribute?.('aria-label'),
    element?.textContent,
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value'),
    element?.getAttribute?.('data-testid'),
  ].map(normalize).find(Boolean) || '';
  const blockingLoginVisible = () => {
    if (/(^|\/)(login|signin|sign-in|auth)(?:\/|[?#]|$)/i.test(
          String(location.pathname || ''))) {
      return true;
    }
    for (const element of document.querySelectorAll(credentialSelector)) {
      if (visible(element)) return true;
    }
    for (const heading of document.querySelectorAll(authHeadingSelector)) {
      if (visible(heading) && serviceConnectPattern.test(labelOf(heading))) return true;
    }
    for (const element of document.querySelectorAll(selector)) {
      const label = labelOf(element);
      const href = String(element?.getAttribute?.('href') || '').toLowerCase();
      if (loginPattern.test(label) ||
          /(^|\/)(login|signin|sign-in)(?:\/|[?#]|$)/i.test(href)) {
        return true;
      }
    }
    return false;
  };
  const playing = () => {
    if (typeof window.__homepanelAudioPlaying === 'boolean') {
      return window.__homepanelAudioPlaying;
    }
    if (navigator.mediaSession?.playbackState === 'playing') return true;
    return Array.from(document.querySelectorAll('audio,video')).some(element =>
      !element.paused && !element.ended && element.readyState >= 2);
  };
  const loginMessage = ')JS"
            << messagePrefix
            << LR"JS(-login-required';
  let pageActive = true;
  let robustLoginReported = false;
  let loginMissingSince = 0;
  let timer = 0;
  let pendingAuthReady = null;
  const restoreAuthAfterFalsePositive = () => {
    const last = window.__homepanelStationheadLastAcceptedAuthHeaders;
    if (!last?.authorization || window.__homepanelStationheadAuthHeaders?.authorization ||
        window.__homepanelStationheadRejectedAuthorization !== last.authorization) {
      return;
    }
    window.__homepanelStationheadRejectedAuthorization = null;
    window.__homepanelStationheadAuthHeaders = Object.assign({}, last);
  };
  const rejectCapturedAuthForBlockingLogin = () => {
    const authorization = window.__homepanelStationheadAuthHeaders?.authorization || '';
    if (authorization) {
      window.__homepanelStationheadRejectedAuthorization = authorization;
    }
    window.__homepanelStationheadAuthHeaders = null;
  };
  const updateBlockingLogin = () => {
    const blocking = blockingLoginVisible();
    const now = Date.now();
    if (blocking) {
      loginMissingSince = 0;
      window.__homepanelStationheadBlockingLoginVisible = true;
      pendingAuthReady = null;
      rejectCapturedAuthForBlockingLogin();
      if (!robustLoginReported && pageActive && nativePost) {
        robustLoginReported = true;
        nativePost(loginMessage);
      }
      return true;
    }
    if (!loginMissingSince) loginMissingSince = now;
    if (now - loginMissingSince >= 3000) {
      window.__homepanelStationheadBlockingLoginVisible = false;
      robustLoginReported = false;
    }
    return false;
  };
  const flushPendingAuthReady = () => {
    if (!pendingAuthReady || !pageActive ||
        window.__homepanelStationheadBlockingLoginVisible !== false) {
      return;
    }
    const message = pendingAuthReady;
    pendingAuthReady = null;
    nativePost?.(message);
  };
  if (webview && nativePost) {
    try {
      webview.postMessage = message => {
        if (!pageActive) return;
        if (message === loginMessage) {
          if (!updateBlockingLogin()) restoreAuthAfterFalsePositive();
          return;
        }
        if (message && typeof message === 'object' &&
            message.type === 'stationhead-auth-ready') {
          pendingAuthReady = message;
          nativeTimeout(() => {
            if (!pageActive) return;
            updateBlockingLogin();
            flushPendingAuthReady();
          }, 0);
          return;
        }
        return nativePost(message);
      };
    } catch (_) {}
  }
  const baseScan = () => {
    try { window.)JS"
            << globalName
            << LR"JS(?.scan?.(0); } catch (_) {}
  };
  const scan = () => {
    baseScan();
    updateBlockingLogin();
    flushPendingAuthReady();
  };
  const schedule = () => {
    if (timer) return;
    timer = nativeTimeout(() => {
      timer = 0;
      if (pageActive) {
        if (playing()) baseScan();
        updateBlockingLogin();
        flushPendingAuthReady();
      }
      schedule();
    }, 5000);
  };
  window.addEventListener('pagehide', () => { pageActive = false; }, true);
  window.addEventListener('pageshow', () => {
    pageActive = true;
    scan();
  }, true);
  window.addEventListener('homepanel-stationhead-auth-ready', () => {
    robustLoginReported = false;
    loginMissingSince = 0;
    scan();
  });
  updateBlockingLogin();
  schedule();
})()
)JS";

  std::wstring script = extension.str();
  script.push_back(L'\n');
  script.append(StationheadAudioOnlyUiScript());
  script.push_back(L'\n');
  script.append(StationheadBlankPageRecoveryScriptRuntimeFixed());
  script.push_back(L'\n');
  script.append(StationheadAutoplayScriptBase(globalName, messagePrefix));
  return script;
}

// The page can complete a fresh login while retaining the same bearer token.
// The base capture policy deliberately rejects a token once a blocking login
// surface is observed, so release that rejection only after the refined login
// detector has observed a stable non-blocking page. The next page-owned request
// then revalidates and recaptures the same token without an extra API call.
inline std::wstring StationheadAuthCaptureScriptRuntimeFixed() {
  std::wstring script = StationheadAuthCaptureScript();
  script.append(LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if ((host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) ||
      window.top !== window) return;
  if (window.__homepanelStationheadAuthReuseFix) return;
  window.__homepanelStationheadAuthReuseFix = true;
  const rememberAcceptedAuthorization = () => {
    const headers = window.__homepanelStationheadAuthHeaders;
    if (headers?.authorization) {
      window.__homepanelStationheadLastAcceptedAuthHeaders = Object.assign({}, headers);
    }
  };
  const releaseRejectedAuthorization = authorization => {
    if (!authorization ||
        authorization !== window.__homepanelStationheadRejectedAuthorization ||
        window.__homepanelStationheadBlockingLoginVisible !== false) {
      return;
    }
    window.__homepanelStationheadRejectedAuthorization = null;
  };
  const currentFetch = window.fetch ? window.fetch.bind(window) : null;
  if (currentFetch) {
    window.fetch = function(input, init) {
      try {
        const headers = new Headers((input && input.headers) || {});
        if (init && init.headers) {
          const initHeaders = new Headers(init.headers);
          initHeaders.forEach((value, name) => headers.set(name, value));
        }
        releaseRejectedAuthorization(headers.get('authorization') || '');
      } catch (_) {}
      const result = currentFetch(input, init);
      rememberAcceptedAuthorization();
      return result;
    };
  }
  const NativeXhr = window.XMLHttpRequest;
  if (NativeXhr) {
    const currentSend = NativeXhr.prototype.send;
    NativeXhr.prototype.send = function(...args) {
      try {
        releaseRejectedAuthorization(this.__homepanelHeaders?.authorization || '');
      } catch (_) {}
      const result = currentSend.apply(this, args);
      rememberAcceptedAuthorization();
      return result;
    };
  }
})()
)JS");
  return script;
}

// Window A's successful stats request is throttled for ten minutes, but that
// throttle must belong to the exact authorization value that was validated.
// A 401 invalidates that authorization; a 403 can be endpoint permission or a
// temporary policy response and must not discard the playback session token.
inline std::wstring StationheadApiPlayStatsScriptRuntimeFixed(int channelId) {
  std::wostringstream script;
  script << LR"JS(
(() => {
  const post = message => {
    try { window.chrome?.webview?.postMessage(message); } catch (_) {}
  };
  const resetSuccessThrottle = () => {
    window.__homepanelStationheadPlayStatsSuccessAt = 0;
    window.__homepanelStationheadPlayStatsAuthorization = '';
  };
  const headers = window.__homepanelStationheadAuthHeaders;
  if (!headers?.authorization) {
    resetSuccessThrottle();
    post({ type: 'stationhead-play-stats-error', error: 'no-auth-header' });
    return false;
  }
  const lastSuccessAt = Number(window.__homepanelStationheadPlayStatsSuccessAt || 0);
  const lastSuccessAuthorization = String(
    window.__homepanelStationheadPlayStatsAuthorization || '');
  if (lastSuccessAt > 0 &&
      lastSuccessAuthorization === headers.authorization &&
      Date.now() - lastSuccessAt < 10 * 60 * 1000) {
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
    if (response.status === 401) {
      resetSuccessThrottle();
      window.__homepanelStationheadRejectedAuthorization = headers.authorization;
      window.__homepanelStationheadAuthHeaders = null;
      post({ type: 'stationhead-play-stats-auth-failed', status: response.status });
      return null;
    }
    if (response.status === 403) {
      resetSuccessThrottle();
      post({ type: 'stationhead-play-stats-error', error: 'forbidden' });
      return null;
    }
    if (!response.ok) throw new Error('http-' + response.status);
    return response.json();
  }).then(data => {
    if (data) {
      window.__homepanelStationheadPlayStatsSuccessAt = Date.now();
      window.__homepanelStationheadPlayStatsAuthorization = headers.authorization;
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

}  // namespace hp

// These macros are intentionally defined after the wrappers. Calls compiled
// after the precompiled-header boundary use the fixed runtime policy, while the
// wrapper bodies above still refer to the original policy functions.
#define ApplyStationheadResourceBlocking ApplyStationheadResourceBlockingRuntimeFixed
#define StationheadAuthCaptureScript StationheadAuthCaptureScriptRuntimeFixed
#define StationheadAutoplayScript StationheadAutoplayScriptRuntimeFixed
#define StationheadLocateStartButtonScript StationheadLocateStartButtonScriptRuntimeFixed
#define StationheadApiPlayStatsScript StationheadApiPlayStatsScriptRuntimeFixed