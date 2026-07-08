#include "sh.h"
#include "shared_webview_environment.h"
#include "sh_shared.h"
#include <psapi.h>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
double OptionalNumber(const winrt::Windows::Data::Json::JsonObject& object,
                      const wchar_t* name, double fallback = 0) {
  if (!object.HasKey(name)) return fallback;
  const auto value = object.GetNamedValue(name);
  return value.ValueType() == winrt::Windows::Data::Json::JsonValueType::Number
      ? value.GetNumber()
      : fallback;
}

const wchar_t* kStartupScanScript = LR"JS(
(() => {
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const selector = "button,[role='button'],a,input[type='button'],input[type='submit'],[aria-label],[data-testid],[tabindex]";
  const startPattern = /\b(start|join|resume)\s+(listening|station|show|room)\b|\blisten\s+(now|live)\b/i;
  const labelOf = element => [
    element?.innerText,
    element?.getAttribute?.('aria-label'),
    element?.textContent,
    element?.getAttribute?.('title'),
    element?.getAttribute?.('value'),
    element?.getAttribute?.('data-testid')
  ].map(normalize).find(Boolean) || '';
  const visible = element => {
    if (!element || element.disabled || element.getAttribute?.('aria-disabled') === 'true' || element.getAttribute?.('aria-hidden') === 'true') return false;
    const rect = element.getBoundingClientRect?.();
    if (!rect || rect.width <= 2 || rect.height <= 2) return false;
    const style = getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0 && style.pointerEvents !== 'none';
  };
  const ready = document.readyState === 'complete' && !!document.body;
  const actions = Array.from(document.querySelectorAll(selector)).filter(visible);
  const active = actions.find(element => /^(stop\s+listening|now\s+listening|you.?re\s+listening|listening\s+now|leave\s+station)(?:\s+.*)?$/i.test(labelOf(element)));
  const mediaPlaying = Array.from(document.querySelectorAll('audio,video')).some(element => !element.paused && !element.ended && element.readyState >= 2 && element.currentTime > 0);
  const sessionPlaying = navigator.mediaSession?.playbackState === 'playing';
  if (mediaPlaying || sessionPlaying || active) return JSON.stringify({ ready, done: true, audio: mediaPlaying || sessionPlaying, login: false, label: active ? labelOf(active) : '' });
  const start = ready ? actions.find(element => startPattern.test(labelOf(element))) : null;
  const login = ready && !start && (
    actions.some(element => /^(log\s*in|sign\s*in|login)(?:\s+.*)?$/i.test(labelOf(element))) ||
    /\/log(?:in|out)|\/sign-?in/i.test(location.pathname)
  );
  if (start) {
    const target = start.closest?.("button,[role='button'],a,input[type='button'],input[type='submit'],[tabindex]") || start;
    target.scrollIntoView?.({ block: 'center', inline: 'center' });
    target.focus?.({ preventScroll: true });
    const rect = target.getBoundingClientRect();
    return JSON.stringify({ ready, done: false, login: false, target: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, label: labelOf(target) } });
  }
  return JSON.stringify({ ready, done: false, login, target: null });
})()
)JS";

const wchar_t* kStationheadAppPatch = LR"JS(
(() => {
  const host = String(location.hostname || '').toLowerCase();
  if (host !== 'stationhead.com' && !host.endsWith('.stationhead.com')) return;
  if (window.__homepanelStationheadPatch) return;
  let audioNotifyQueued = false;
  let audioStopTimerId = 0;
  let lastAudioSignature = '';
  let lastMediaEvent = '';
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClearTimeout = window.clearTimeout.bind(window);
  const publishAudioState = (force = false) => {
    audioNotifyQueued = false;
    const media = Array.from(document.querySelectorAll('audio,video'));
    const stopped = ['pause','ended','emptied','error','abort'].includes(lastMediaEvent);
    const interrupted = stopped || ['stalled','waiting'].includes(lastMediaEvent);
    const mediaPlaying = !interrupted && media.some(element => !element.paused && !element.ended && element.readyState >= 2);
    const sessionPlaying = !interrupted && navigator.mediaSession?.playbackState === 'playing';
    const metadata = navigator.mediaSession?.metadata;
    const payload = {
      type: 'stationhead-audio-state',
      playing: Boolean(mediaPlaying || sessionPlaying),
      stopped,
      reason: lastMediaEvent,
      title: metadata?.title || '',
      artist: metadata?.artist || '',
      artwork: metadata?.artwork?.[0]?.src || ''
    };
    const signature = JSON.stringify(payload);
    if (!force && signature === lastAudioSignature) return;
    lastAudioSignature = signature;
    try { window.chrome?.webview?.postMessage(payload); } catch (_) {}
  };
  const queueAudioState = event => {
    const type = event?.type || lastMediaEvent;
    lastMediaEvent = type;
    const stopped = ['pause','ended','emptied','error','abort'].includes(type);
    const resumed = ['play','playing','canplay','loadedmetadata','durationchange'].includes(type);
    if (resumed && audioStopTimerId) {
      nativeClearTimeout(audioStopTimerId);
      audioStopTimerId = 0;
    }
    if (stopped) {
      if (audioStopTimerId) nativeClearTimeout(audioStopTimerId);
      const stoppedType = type;
      audioStopTimerId = nativeTimeout(() => {
        audioStopTimerId = 0;
        lastMediaEvent = stoppedType;
        publishAudioState();
      }, 10000);
      return;
    }
    if (audioNotifyQueued) return;
    audioNotifyQueued = true;
    nativeTimeout(publishAudioState, 0);
  };
  for (const eventName of ['play','playing','canplay','loadedmetadata','durationchange','pause','ended','stalled','waiting','emptied','error','abort']) {
    document.addEventListener(eventName, queueAudioState, true);
  }
  window.addEventListener('load', queueAudioState, { once: true });
  if (document.readyState !== 'loading') queueAudioState();
  window.__homepanelStationheadPatch = { publishAudioState };
})()
)JS";

std::wstring JsonStringResult(LPCWSTR result) {
  if (!result) return {};
  try {
    return winrt::Windows::Data::Json::JsonValue::Parse(result).GetString().c_str();
  } catch (...) {
    return result;
  }
}

std::wstring HResultHex(HRESULT hr) {
  std::wostringstream output;
  output << L"0x" << std::hex << std::setw(8) << std::setfill(L'0') << static_cast<unsigned long>(hr);
  return output.str();
}
}  // namespace

StationheadPlayer::StationheadPlayer(HWND window, StationheadConfig config, fs::path userDataFolder, Logger& log)
    : window_(window), config_(std::move(config)), userDataFolder_(std::move(userDataFolder)),
      log_(log) {
  bounds_ = RECT{0, 0, 1, 1};
}

StationheadPlayer::~StationheadPlayer() { Stop(); }

void StationheadPlayer::Start() {
  shuttingDown_ = false;
  ResetNavigationRouteState(UnixMillis());
  Create();
}

void StationheadPlayer::Stop() {
  shuttingDown_ = true;
  CloseAuthWebView();
  CloseWebView();
  if (authHostWindow_ && IsWindow(authHostWindow_)) DestroyWindow(authHostWindow_);
  if (hostWindow_ && IsWindow(hostWindow_)) DestroyWindow(hostWindow_);
  authHostWindow_ = nullptr;
  hostWindow_ = nullptr;
}

StationheadStatus StationheadPlayer::Status() const {
  std::lock_guard lock(mutex_);
  StationheadStatus copy = status_;
  copy.authAvailable = authController_ != nullptr || !authPendingUrl_.empty();
  copy.spotifyAuthorization = copy.authAvailable;
  copy.apiAuthorization = false;
  copy.audioPlaying = audioPlaying_.load(std::memory_order_relaxed);
  copy.audioSilent = false;
  copy.lightweight = false;
  copy.blockedResources = 0;
  copy.audioMuted = audioMuted_.load(std::memory_order_relaxed);
  return copy;
}

void StationheadPlayer::ResetNavigationRouteState(int64_t nowMs) {
  usedFallback_ = false;
  usedSakurazaka_ = false;
  waitingForStartTransition_ = false;
  startupScanUntil_ = nowMs + 120'000;
  lastScanAt_ = 0;
  createdForAudioCheckAt_ = nowMs;
  lastAudioAtMs_ = 0;
  audioPlaying_ = false;
  audioStateKnown_ = false;
  nextTickAt_ = 0;
}

void StationheadPlayer::NavigatePrimaryUrl(int64_t nowMs, const std::wstring& reason) {
  if (!webview_) return;
  selectedTab_ = StationheadTabKind::Stationhead;
  SetVisible(true);
  ResetNavigationRouteState(nowMs);
  {
    std::lock_guard lock(mutex_);
    status_.navigating = true;
    status_.url = config_.url;
    status_.detail = reason;
  }
  webview_->Navigate(config_.url.c_str());
  log_.Info(L"Stationhead navigation (" + reason + L"): " + config_.url);
}

void StationheadPlayer::Create() {
  if (shuttingDown_ || creating_.exchange(true)) return;
  if (!EnsureHostWindow()) {
    creating_ = false;
    ScheduleRecreate(L"main window unavailable");
    return;
  }
  SharedWebViewEnvironment::Instance().Acquire(
      userDataFolder_, [this](HRESULT result, ICoreWebView2Environment* environment) {
        if (FAILED(result) || !environment || shuttingDown_) {
          creating_ = false;
          if (!shuttingDown_) ScheduleRecreate(L"shared environment acquisition failed " + HResultHex(result));
          return;
        }
        environment_ = environment;
        const HRESULT started = environment_->CreateCoreWebView2Controller(
            hostWindow_, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                             [this](HRESULT controllerResult, ICoreWebView2Controller* controller) -> HRESULT {
                               creating_ = false;
                               if (FAILED(controllerResult) || !controller || shuttingDown_) {
                                 if (controller) controller->Close();
                                 if (!shuttingDown_) ScheduleRecreate(L"controller creation failed " + HResultHex(controllerResult));
                                 return S_OK;
                               }
                               controller_ = controller;
                               controller_->put_IsVisible(FALSE);
                               controller_->get_CoreWebView2(&webview_);
                               ConfigureWebView();
                               return S_OK;
                             }).Get());
        if (FAILED(started)) {
          creating_ = false;
          ScheduleRecreate(L"controller creation could not start " + HResultHex(started));
        }
      });
}

void StationheadPlayer::EnsureAuthController(const std::wstring& url) {
  authPendingUrl_ = url;
  if (!environment_ || authController_ || !EnsureAuthHostWindow()) return;
  environment_->CreateCoreWebView2Controller(
      authHostWindow_, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                           [this](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                             if (FAILED(result) || !controller || shuttingDown_) {
                               if (controller) controller->Close();
                               return S_OK;
                             }
                             authController_ = controller;
                             controllerLayoutValid_ = false;
                             authController_->put_IsVisible(FALSE);
                             authController_->get_CoreWebView2(&authWebview_);
                             ConfigureAuthWebView();
                             return S_OK;
                           }).Get());
}

void StationheadPlayer::ConfigureWebView() {
  selectedTab_ = StationheadTabKind::Stationhead;
  viewVisible_ = true;
  SetVisible(true);
  ComPtr<ICoreWebView2Controller2> controller2;
  if (SUCCEEDED(controller_.As(&controller2))) {
    COREWEBVIEW2_COLOR background{255, 7, 17, 28};
    controller2->put_DefaultBackgroundColor(background);
  }
  ComPtr<ICoreWebView2Settings> settings;
  webview_->get_Settings(&settings);
  if (settings) {
    settings->put_AreDefaultContextMenusEnabled(FALSE);
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
    ComPtr<ICoreWebView2Settings3> settings3;
    if (SUCCEEDED(settings.As(&settings3))) settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
  }
  ApplyStationheadResourceBlocking(environment_.Get(), webview_.Get(), config_, resourceBlockingArmed_, resourceRequestedToken_);
  webview_->add_NavigationCompleted(
      Callback<ICoreWebView2NavigationCompletedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
            BOOL success = FALSE;
            COREWEBVIEW2_WEB_ERROR_STATUS webError{};
            if (args) {
              args->get_IsSuccess(&success);
              args->get_WebErrorStatus(&webError);
            }
            if (spotifyAuthorization_) {
              std::lock_guard lock(mutex_);
              status_.navigating = false;
              status_.detail = success ? L"Spotify login ready" : L"Spotify authentication navigation failed";
              PostChange();
              return S_OK;
            }
            {
              std::lock_guard lock(mutex_);
              status_.navigating = false;
              status_.detail = success ? L"navigation completed" : L"navigation failed";
            }
            if (success) {
              lastReloadAt_ = UnixMillis();
              lastScanAt_ = 0;
              EvaluateStartupState();
            } else {
              ScheduleRecreate(L"navigation failed " + std::to_wstring(static_cast<int>(webError)));
            }
            PostChange();
            return S_OK;
          }).Get(), &navigationToken_);
  webview_->add_NewWindowRequested(
      Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
            if (!args || !environment_ || !EnsureAuthHostWindow()) return S_OK;
            LPWSTR uriRaw = nullptr;
            args->get_Uri(&uriRaw);
            const std::wstring uri = uriRaw ? uriRaw : L"";
            if (uriRaw) CoTaskMemFree(uriRaw);
            ComPtr<ICoreWebView2Deferral> deferral;
            if (FAILED(args->GetDeferral(&deferral)) || !deferral) return S_OK;
            ComPtr<ICoreWebView2NewWindowRequestedEventArgs> popupArgs = args;
            CloseAuthWebView();
            spotifyAuthorization_ = true;
            selectedTab_ = StationheadTabKind::Auth;
            viewVisible_ = true;
            LayoutControllers();
            const HRESULT createResult = environment_->CreateCoreWebView2Controller(
                authHostWindow_, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                                     [this, popupArgs, deferral, uri](HRESULT result, ICoreWebView2Controller* controller) -> HRESULT {
                                       if (FAILED(result) || !controller || shuttingDown_) {
                                         if (controller) controller->Close();
                                         spotifyAuthorization_ = false;
                                         deferral->Complete();
                                         PostChange();
                                         return S_OK;
                                       }
                                       authController_ = controller;
                                       authController_->put_IsVisible(FALSE);
                                       authController_->get_CoreWebView2(&authWebview_);
                                       ConfigureAuthWebView();
                                       if (SUCCEEDED(popupArgs->put_NewWindow(authWebview_.Get()))) {
                                         popupArgs->put_Handled(TRUE);
                                         SelectTab(StationheadTabKind::Auth);
                                         log_.Info(L"Stationhead popup attached to auth tab: " + uri);
                                       }
                                       deferral->Complete();
                                       PostChange();
                                       return S_OK;
                                     }).Get());
            if (FAILED(createResult)) {
              spotifyAuthorization_ = false;
              deferral->Complete();
              PostChange();
            }
            return S_OK;
          }).Get(), &newWindowToken_);
  webview_->add_WebMessageReceived(
      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            LPWSTR messageRaw = nullptr;
            if (FAILED(args->get_WebMessageAsJson(&messageRaw)) || !messageRaw) return S_OK;
            const std::wstring messageJson = messageRaw;
            CoTaskMemFree(messageRaw);
            try {
              const auto message = winrt::Windows::Data::Json::JsonObject::Parse(messageJson);
              const std::wstring type = message.GetNamedString(L"type", L"").c_str();
              if (type == L"stationhead-audio-state") {
                const bool playing = message.GetNamedBoolean(L"playing", false);
                const bool stopped = message.GetNamedBoolean(L"stopped", false);
                const int64_t now = UnixMillis();
                audioStateKnown_ = true;
                audioPlaying_ = playing;
                if (playing) lastAudioAtMs_ = now;
                const std::wstring title = message.GetNamedString(L"title", L"").c_str();
                const std::wstring artist = message.GetNamedString(L"artist", L"").c_str();
                const std::wstring artwork = message.GetNamedString(L"artwork", L"").c_str();
                bool revealPlayer = false;
                {
                  std::lock_guard lock(mutex_);
                  status_.audioPlaying = playing;
                  status_.audioSilent = false;
                  if (!title.empty()) status_.trackTitle = title;
                  if (!artist.empty()) status_.trackArtist = artist;
                  if (!artwork.empty()) status_.artworkUrl = artwork;
                  revealPlayer = stopped && !playing;
                }
                nextTickAt_ = 0;
                PostChange(revealPlayer ? StationheadChangeShowPlayer : StationheadChangeNone);
                return S_OK;
              }
              if (!spotifyAuthorization_ || (type != L"spotify-connected" && type != L"spotify-error")) return S_OK;
              spotifyAuthorization_ = false;
              showAfterNavigation_ = false;
              {
                std::lock_guard lock(mutex_);
                status_.navigating = false;
                status_.spotifyConfigured = type == L"spotify-connected";
                status_.detail = type == L"spotify-connected" ? L"Spotify authentication completed" : L"Spotify authentication failed or cancelled";
              }
              SetVisible(false);
              PostChange(StationheadChangeReturnMain | StationheadChangeReleaseAuth);
            } catch (...) {
            }
            return S_OK;
          }).Get(), &webMessageToken_);
  webview_->add_ProcessFailed(
      Callback<ICoreWebView2ProcessFailedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs* args) -> HRESULT {
            COREWEBVIEW2_PROCESS_FAILED_KIND kind{};
            if (args) args->get_ProcessFailedKind(&kind);
            {
              std::lock_guard lock(mutex_);
              status_.processFailed = true;
              status_.detail = L"ProcessFailed " + std::to_wstring(kind);
            }
            ScheduleRecreate(L"ProcessFailed");
            return S_OK;
          }).Get(), &processFailedToken_);
  ComPtr<ICoreWebView2_19> v19;
  if (config_.lowMemoryMode && SUCCEEDED(webview_.As(&v19))) {
    // Was set to NORMAL (the default) instead of LOW, silently making this a
    // no-op whenever low-memory mode was actually requested.
    v19->put_MemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
  }
  {
    std::lock_guard lock(mutex_);
    const bool playing = status_.playing;
    const bool spotifyConfigured = status_.spotifyConfigured;
    const int64_t lastConfirmed = status_.lastPlaybackConfirmedAt;
    status_ = {};
    status_.created = true;
    status_.navigating = true;
    status_.url = config_.url;
    status_.detail = L"起動中";
    status_.playing = playing;
    status_.spotifyConfigured = spotifyConfigured;
    status_.lastPlaybackConfirmedAt = lastConfirmed;
  }
  createdAt_ = lastReloadAt_ = UnixMillis();
  startupScanUntil_ = createdAt_ + 120'000;
  waitingForStartTransition_ = false;
  lastAudioAtMs_ = 0;
  lastScanAt_ = 0;
  targetSignature_.clear();
  stableTargetCount_ = 0;
  audioPlaying_ = false;
  audioStateKnown_ = false;
  nextTickAt_ = 0;
  auto startStationheadNavigation = [this]() {
    if (!pendingAuthorizationUrl_.empty()) {
      const std::wstring authorizationUrl = pendingAuthorizationUrl_;
      pendingAuthorizationUrl_.clear();
      OpenSpotifyAuthorization(authorizationUrl);
      return;
    }
    NavigatePrimaryUrl(UnixMillis(), L"startup");
  };
  const HRESULT patchRegistration = webview_->AddScriptToExecuteOnDocumentCreated(
      kStationheadAppPatch,
      Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(
          [this, startStationheadNavigation](HRESULT result, LPCWSTR) -> HRESULT {
            if (FAILED(result)) log_.Warn(L"Stationhead audio observer registration failed " + HResultHex(result));
            startStationheadNavigation();
            return S_OK;
          }).Get());
  if (FAILED(patchRegistration)) startStationheadNavigation();
}

void StationheadPlayer::CloseWebView() {
  controllerLayoutValid_ = false;
  if (webview_) {
    if (navigationToken_.value) webview_->remove_NavigationCompleted(navigationToken_);
    if (newWindowToken_.value) webview_->remove_NewWindowRequested(newWindowToken_);
    if (webMessageToken_.value) webview_->remove_WebMessageReceived(webMessageToken_);
    if (processFailedToken_.value) webview_->remove_ProcessFailed(processFailedToken_);
    if (resourceRequestedToken_.value) webview_->remove_WebResourceRequested(resourceRequestedToken_);
  }
  navigationToken_ = {};
  newWindowToken_ = {};
  webMessageToken_ = {};
  processFailedToken_ = {};
  resourceRequestedToken_ = {};
  resourceBlockingArmed_ = false;
  if (controller_) controller_->Close();
  webview_.Reset();
  controller_.Reset();
  environment_.Reset();
  if (hostWindow_ && IsWindow(hostWindow_)) ShowWindow(hostWindow_, SW_HIDE);
  scanPending_ = false;
  spotifyAuthorization_ = false;
  loginSessionActive_ = false;
  showAfterNavigation_ = false;
  std::lock_guard lock(mutex_);
  status_.created = false;
  status_.lightweight = false;
}

void StationheadPlayer::ConfigureAuthWebView() {
  if (!authController_ || !authWebview_) return;
  ComPtr<ICoreWebView2Controller2> controller2;
  if (SUCCEEDED(authController_.As(&controller2))) {
    COREWEBVIEW2_COLOR background{255, 7, 17, 28};
    controller2->put_DefaultBackgroundColor(background);
  }
  ComPtr<ICoreWebView2Settings> settings;
  authWebview_->get_Settings(&settings);
  if (settings) {
    settings->put_AreDefaultContextMenusEnabled(FALSE);
    settings->put_AreDevToolsEnabled(FALSE);
    settings->put_IsStatusBarEnabled(FALSE);
    settings->put_IsZoomControlEnabled(FALSE);
  }
  authWebview_->add_NavigationCompleted(
      Callback<ICoreWebView2NavigationCompletedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
            BOOL success = FALSE;
            if (args) args->get_IsSuccess(&success);
            if (success) {
              SelectTab(StationheadTabKind::Auth);
              authWebview_->PostWebMessageAsJson(L"{\"type\":\"auth-tab-ready\"}");
            }
            return S_OK;
          }).Get(), &authNavigationToken_);
  authWebview_->add_WindowCloseRequested(
      Callback<ICoreWebView2WindowCloseRequestedEventHandler>(
          [this](ICoreWebView2*, IUnknown*) -> HRESULT {
            spotifyAuthorization_ = false;
            showAfterNavigation_ = false;
            authPendingUrl_.clear();
            SelectTab(StationheadTabKind::None);
            PostChange(StationheadChangeReturnMain | StationheadChangeReleaseAuth);
            return S_OK;
          }).Get(), &authCloseToken_);
  authWebview_->add_WebMessageReceived(
      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT {
            LPWSTR messageRaw = nullptr;
            if (FAILED(args->get_WebMessageAsJson(&messageRaw)) || !messageRaw) return S_OK;
            const std::wstring messageJson = messageRaw;
            CoTaskMemFree(messageRaw);
            try {
              const auto message = winrt::Windows::Data::Json::JsonObject::Parse(messageJson);
              const std::wstring type = message.GetNamedString(L"type", L"").c_str();
              if (type != L"spotify-connected" && type != L"spotify-error") return S_OK;
              spotifyAuthorization_ = false;
              showAfterNavigation_ = false;
              authPendingUrl_.clear();
              {
                std::lock_guard lock(mutex_);
                status_.navigating = false;
                status_.spotifyConfigured = type == L"spotify-connected";
                status_.detail = type == L"spotify-connected" ? L"Spotify authentication completed" : L"Spotify authentication failed or cancelled";
              }
              SelectTab(StationheadTabKind::None);
              PostChange(StationheadChangeReturnMain | StationheadChangeReleaseAuth);
            } catch (...) {
            }
            return S_OK;
          }).Get(), &authMessageToken_);
  authWebview_->add_ProcessFailed(
      Callback<ICoreWebView2ProcessFailedEventHandler>(
          [this](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) -> HRESULT {
            SelectTab(StationheadTabKind::None);
            PostChange(StationheadChangeReturnMain);
            return S_OK;
          }).Get(), &authProcessFailedToken_);
  if (!authPendingUrl_.empty()) authWebview_->Navigate(authPendingUrl_.c_str());
}

void StationheadPlayer::CloseAuthWebView() {
  controllerLayoutValid_ = false;
  if (authWebview_) {
    if (authNavigationToken_.value) authWebview_->remove_NavigationCompleted(authNavigationToken_);
    if (authMessageToken_.value) authWebview_->remove_WebMessageReceived(authMessageToken_);
    if (authProcessFailedToken_.value) authWebview_->remove_ProcessFailed(authProcessFailedToken_);
    if (authCloseToken_.value) authWebview_->remove_WindowCloseRequested(authCloseToken_);
  }
  authNavigationToken_ = {};
  authMessageToken_ = {};
  authProcessFailedToken_ = {};
  authCloseToken_ = {};
  if (authController_) authController_->Close();
  authWebview_.Reset();
  authController_.Reset();
  authPendingUrl_.clear();
}

void StationheadPlayer::EvaluateStartupState() {
  if (!webview_ || scanPending_.exchange(true)) return;
  webview_->ExecuteScript(
      kStartupScanScript,
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this](HRESULT error, LPCWSTR result) -> HRESULT {
            scanPending_ = false;
            HandleStartupStateResult(error, result);
            return S_OK;
          }).Get());
}

void StationheadPlayer::HandleStartupStateResult(HRESULT error, LPCWSTR result) {
  if (FAILED(error) || !result) return;
  try {
    auto object = winrt::Windows::Data::Json::JsonObject::Parse(JsonStringResult(result));
    const bool ready = object.GetNamedBoolean(L"ready", false);
    const bool done = object.GetNamedBoolean(L"done", false);
    const bool login = object.GetNamedBoolean(L"login", false);
    if (login) {
      if (!loginSessionActive_) {
        loginSessionActive_ = true;
        ShowForLogin();
      }
      std::lock_guard lock(mutex_);
      status_.loginRequired = true;
      status_.detail = L"login required";
      return;
    }
    if (loginSessionActive_) {
      loginSessionActive_ = false;
      std::lock_guard lock(mutex_);
      status_.loginRequired = false;
      status_.detail = L"login completed; waiting for Stationhead";
    }
    if (done) {
      const bool audio = object.GetNamedBoolean(L"audio", false);
      const int64_t now = UnixMillis();
      if (!audio) {
        lastAudioAtMs_ = 0;
        std::lock_guard lock(mutex_);
        status_.loginRequired = false;
        status_.detail = now - createdAt_ > 45'000 ? L"起動していません" : L"起動中";
        return;
      }
      if (lastAudioAtMs_ <= 0) {
        lastAudioAtMs_ = now;
        std::lock_guard lock(mutex_);
        status_.loginRequired = false;
        status_.detail = L"再生を確認中";
        return;
      }
      if (now - lastAudioAtMs_ < 5'000) {
        std::lock_guard lock(mutex_);
        status_.loginRequired = false;
        status_.detail = L"再生を確認中";
        return;
      }
      {
        std::lock_guard lock(mutex_);
        status_.loginRequired = false;
        status_.detail = L"再生中";
        status_.audioPlaying = true;
      }
      audioPlaying_ = true;
      resourceBlockingArmed_ = true;
      waitingForStartTransition_ = false;
      startupScanUntil_ = 0;
      SetVisible(false);
      PostChange(StationheadChangeReturnMain);
      return;
    }
    const bool hasTarget = object.HasKey(L"target") &&
        object.GetNamedValue(L"target").ValueType() == winrt::Windows::Data::Json::JsonValueType::Object;
    if (hasTarget) {
      auto target = object.GetNamedObject(L"target");
      const double x = target.GetNamedNumber(L"x", -1);
      const double y = target.GetNamedNumber(L"y", -1);
      const std::wstring label = target.GetNamedString(L"label", L"").c_str();
      const std::wstring signature = label + L":" + std::to_wstring(static_cast<int>(x)) + L":" + std::to_wstring(static_cast<int>(y));
      if (signature == targetSignature_) ++stableTargetCount_;
      else { targetSignature_ = signature; stableTargetCount_ = 1; }
      if (stableTargetCount_ >= 2 && x >= 0 && y >= 0) {
        ClickTarget(x, y);
        stableTargetCount_ = 0;
      }
    } else {
      targetSignature_.clear();
      stableTargetCount_ = 0;
      if (waitingForStartTransition_ && ready) {
        waitingForStartTransition_ = false;
        std::lock_guard lock(mutex_);
        status_.detail = L"Start Listening accepted; waiting for confirmed playback";
      }
    }
  } catch (...) {
  }
}

void StationheadPlayer::ClickTarget(double x, double y) {
  if (!webview_) return;
  std::wostringstream script;
  script << L"(() => { const e=document.elementFromPoint(" << x << L"," << y
         << L"); if(!e)return false; const t=e.closest?.('button,[role=button],a,input,[tabindex]')||e; t.focus?.(); t.click?.(); return true; })()";
  webview_->ExecuteScript(
      script.str().c_str(),
      Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
          [this, x, y](HRESULT result, LPCWSTR value) -> HRESULT {
            if (!(SUCCEEDED(result) && value && std::wstring(value).find(L"true") != std::wstring::npos) && webview_) {
              std::wostringstream moved, pressed, released;
              moved << L"{\"type\":\"mouseMoved\",\"x\":" << x << L",\"y\":" << y << L"}";
              pressed << L"{\"type\":\"mousePressed\",\"x\":" << x << L",\"y\":" << y << L",\"button\":\"left\",\"buttons\":1,\"clickCount\":1}";
              released << L"{\"type\":\"mouseReleased\",\"x\":" << x << L",\"y\":" << y << L",\"button\":\"left\",\"buttons\":0,\"clickCount\":1}";
              webview_->CallDevToolsProtocolMethod(L"Input.dispatchMouseEvent", moved.str().c_str(), nullptr);
              webview_->CallDevToolsProtocolMethod(L"Input.dispatchMouseEvent", pressed.str().c_str(), nullptr);
              webview_->CallDevToolsProtocolMethod(L"Input.dispatchMouseEvent", released.str().c_str(), nullptr);
            }
            waitingForStartTransition_ = true;
            startupScanUntil_ = UnixMillis() + 60'000;
            lastAudioAtMs_ = 0;
            lastScanAt_ = 0;
            {
              std::lock_guard lock(mutex_);
              status_.detail = L"Start Listening clicked; waiting for confirmed playback";
            }
            PostChange();
            return S_OK;
          }).Get());
}

void StationheadPlayer::OpenSpotifyAuthorization(const std::wstring& url) {
  if (url.empty()) return;
  if (!webview_) {
    pendingAuthorizationUrl_ = url;
    if (!creating_) ScheduleRecreate(L"Spotify authorization requested before WebView2 was ready");
    PostChange();
    return;
  }
  spotifyAuthorization_ = true;
  loginSessionActive_ = false;
  showAfterNavigation_ = true;
  EnsureAuthController(url);
  SelectTab(StationheadTabKind::Auth);
  {
    std::lock_guard lock(mutex_);
    status_.navigating = true;
    status_.detail = L"Spotify login loading";
  }
  if (authWebview_) authWebview_->Navigate(url.c_str());
  PostChange();
}

void StationheadPlayer::ShowForLogin() {
  SelectTab(StationheadTabKind::Stationhead);
  log_.Warn(L"Stationhead login required; Stationhead window visible");
}

void StationheadPlayer::ToggleView() {
  if (!controller_) return;
  bool loginRequired = false;
  {
    std::lock_guard lock(mutex_);
    loginRequired = status_.loginRequired;
  }
  if (spotifyAuthorization_ || loginRequired) {
    SelectTab(selectedTab_ == StationheadTabKind::Auth ? StationheadTabKind::Auth : StationheadTabKind::Stationhead);
    return;
  }
  SetVisible(!viewVisible_);
  PostChange();
}

void StationheadPlayer::PostChange(uint32_t flags) {
  pendingChangeFlags_.fetch_or(flags, std::memory_order_release);
  if (changeMessagePending_.exchange(true, std::memory_order_acq_rel)) return;
  if (!window_ || !IsWindow(window_) || !PostMessageW(window_, WM_HP_STATIONHEAD_CHANGED, 0, 0)) {
    changeMessagePending_ = false;
  }
}

uint32_t StationheadPlayer::ConsumeChangeFlags() {
  const uint32_t flags = pendingChangeFlags_.exchange(0, std::memory_order_acq_rel);
  changeMessagePending_ = false;
  if (pendingChangeFlags_.load(std::memory_order_acquire) != 0 &&
      !changeMessagePending_.exchange(true, std::memory_order_acq_rel) && window_ && IsWindow(window_)) {
    PostMessageW(window_, WM_HP_STATIONHEAD_CHANGED, 0, 0);
  }
  return flags;
}

void StationheadPlayer::ShowAfterAudioStop() {
  if (!webview_) return;
  selectedTab_ = StationheadTabKind::Stationhead;
  viewVisible_ = true;
  controllerLayoutValid_ = false;
  startupScanUntil_ = UnixMillis() + 120'000;
  lastScanAt_ = 0;
  nextTickAt_ = 0;
  {
    std::lock_guard lock(mutex_);
    status_.detail = L"Stationhead audio stopped; player restored";
  }
  SetVisible(true);
  log_.Warn(L"Stationhead audio stopped; restored the player");
}

void StationheadPlayer::ReleaseCompletedAuth() {
  if (!spotifyAuthorization_ && authController_) CloseAuthWebView();
}

void StationheadPlayer::RefreshSpotifyState(bool) {}

void StationheadPlayer::Tick(int64_t nowMs, bool diagnosticsVisible) {
  if (shuttingDown_) return;
  if (nowMs < nextTickAt_ && !recreating_.load(std::memory_order_relaxed)) return;
  nextTickAt_ = nowMs + 60'000;
  if (recreating_.exchange(false)) {
    CloseWebView();
    Create();
    nextTickAt_ = nowMs + 1'000;
    return;
  }
  if (!webview_) {
    if (!creating_ && nowMs - createdAt_ > 5'000) Create();
    nextTickAt_ = nowMs + 1'000;
    return;
  }
  if (!spotifyAuthorization_ && authController_) CloseAuthWebView();
  if (spotifyAuthorization_ || loginSessionActive_) {
    nextTickAt_ = nowMs + 1'000;
    return;
  }
  const int64_t reloadInterval = StationheadReloadIntervalMs(config_.reloadIntervalMinutes);
  if (reloadInterval > 0 && nowMs - lastReloadAt_ >= reloadInterval) {
    lastReloadAt_ = nowMs;
    NavigatePrimaryUrl(nowMs, L"scheduled reload");
    nextTickAt_ = nowMs + 1'000;
    return;
  }
  if (nowMs <= startupScanUntil_ && nowMs - lastScanAt_ >= 1'500) {
    lastScanAt_ = nowMs;
    EvaluateStartupState();
  }
  const int fallbackSec = config_.audioFallbackSeconds;
  if (!usedFallback_ && !usedSakurazaka_ && fallbackSec > 0 && createdForAudioCheckAt_ > 0 &&
      nowMs - createdForAudioCheckAt_ >= static_cast<int64_t>(fallbackSec) * 1'000 &&
      lastAudioAtMs_ == 0 && !config_.fallbackUrl.empty()) {
    usedFallback_ = true;
    createdForAudioCheckAt_ = nowMs;
    lastAudioAtMs_ = 0;
    waitingForStartTransition_ = false;
    startupScanUntil_ = nowMs + 120'000;
    lastScanAt_ = 0;
    {
      std::lock_guard lock(mutex_);
      status_.navigating = true;
      status_.detail = L"no audio - switching to fallback";
    }
    webview_->Navigate(config_.fallbackUrl.c_str());
  }
  if (nowMs - createdAt_ > 45'000) {
    std::lock_guard lock(mutex_);
    if (status_.navigating || status_.created) status_.detail = L"起動していません";
  }
  const int64_t memoryCheckInterval = diagnosticsVisible ? 15'000 : 60 * 60'000;
  if (nowMs - lastMemoryCheckAt_ >= memoryCheckInterval) {
    lastMemoryCheckAt_ = nowMs;
    const size_t memory = MeasureProcessWorkingSet();
    std::lock_guard lock(mutex_);
    status_.processWorkingSet = memory;
  }
  int64_t next = nowMs + 30 * 60'000;
  const auto consider = [&](int64_t deadline) {
    if (deadline <= nowMs) next = nowMs + 1'000;
    else next = std::min(next, deadline);
  };
  if (reloadInterval > 0) consider(lastReloadAt_ + reloadInterval);
  if (nowMs <= startupScanUntil_) consider(lastScanAt_ + 1'500);
  consider(lastMemoryCheckAt_ + memoryCheckInterval);
  if (fallbackSec > 0 && createdForAudioCheckAt_ > 0) consider(createdForAudioCheckAt_ + static_cast<int64_t>(fallbackSec) * 1'000);
  nextTickAt_ = std::max(nowMs + 1'000, next);
}

void StationheadPlayer::NotifyMonitorHandle(const std::wstring& handle) {
  if (config_.sakurazakaUrl.empty() || config_.sakurazakaHandle.empty() || !webview_) return;
  const std::wstring clean = (!handle.empty() && handle.front() == L'@') ? handle.substr(1) : handle;
  const std::wstring target = (!config_.sakurazakaHandle.empty() && config_.sakurazakaHandle.front() == L'@')
      ? config_.sakurazakaHandle.substr(1) : config_.sakurazakaHandle;
  if (_wcsicmp(clean.c_str(), target.c_str()) != 0 || usedSakurazaka_) return;
  usedSakurazaka_ = true;
  usedFallback_ = false;
  createdForAudioCheckAt_ = UnixMillis();
  lastAudioAtMs_ = 0;
  waitingForStartTransition_ = false;
  startupScanUntil_ = UnixMillis() + 120'000;
  lastScanAt_ = 0;
  {
    std::lock_guard lock(mutex_);
    status_.navigating = true;
    status_.detail = L"sakurazaka46jp broadcast detected";
  }
  webview_->Navigate(config_.sakurazakaUrl.c_str());
  PostChange();
}

void StationheadPlayer::ScheduleRecreate(const std::wstring& reason) {
  nextTickAt_ = 0;
  if (shuttingDown_ || recreating_.exchange(true)) return;
  {
    std::lock_guard lock(mutex_);
    status_.detail = L"recreate scheduled: " + reason;
  }
  log_.Warn(L"Stationhead WebView recreate scheduled: " + reason);
  PostChange();
}

void StationheadPlayer::Reconnect() { ScheduleRecreate(L"manual reconnect"); }

size_t StationheadPlayer::MeasureProcessWorkingSet() {
  if (!webview_) return 0;
  UINT32 pid = 0;
  if (FAILED(webview_->get_BrowserProcessId(&pid))) return 0;
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, pid);
  if (!process) return 0;
  PROCESS_MEMORY_COUNTERS_EX counters{};
  counters.cb = sizeof(counters);
  const bool ok = GetProcessMemoryInfo(process, reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&counters), sizeof(counters)) != FALSE;
  CloseHandle(process);
  return ok ? counters.WorkingSetSize : 0;
}
}  // namespace hp

// Feature groups split out of this file; compiled as part of this translation
// unit so they share its includes and file-local helpers (unity-build pattern,
// like renderer_core.cpp). Not listed in CMake on purpose.
#include "sh_player_layout.cpp"
