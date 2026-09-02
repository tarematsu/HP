#include "spotify_webviews.h"
#include "shared_webview_environment.h"

namespace hp {
namespace {
constexpr wchar_t kSpotifyHostClass[] = L"HomePanelSpotifyWebView";
constexpr wchar_t kSpotifyAlbumUrl[] =
    L"https://open.spotify.com/album/2f2Ik9JeinFVWZuFb3i35b";
constexpr wchar_t kSpotifyPodcastUrl[] =
    L"https://open.spotify.com/show/2ZQy2mlwQodabAILwZ02Ed";
constexpr wchar_t kSpotifyLoginUrl[] =
    L"https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2Falbum%2F2f2Ik9JeinFVWZuFb3i35b";
constexpr wchar_t kSpotifyPodcastLoginUrl[] =
    L"https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2Fshow%2F2ZQy2mlwQodabAILwZ02Ed";
constexpr wchar_t kSpotifyProfilePrefix[] = L"spotify-";
constexpr UINT_PTR kSpotifyStartupTimer = 1;
constexpr UINT_PTR kSpotifyModeTimer = 2;
constexpr UINT kSpotifyStartupStaggerMs = 400;
constexpr UINT kSpotifyModePhaseMs = 60U * 60U * 1000U;
constexpr std::array<std::wstring_view, 6> kSpotifyPanelNames = {
    L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata", L"ozeki"};

constexpr wchar_t kSpotifyPlaybackScript[] = LR"JS(
(() => {
  if (window.__homePanelLonesomeRabbitLoop) return;
  window.__homePanelLonesomeRabbitLoop = true;
  const targetUrl = 'https://open.spotify.com/album/2f2Ik9JeinFVWZuFb3i35b';
  const targetPath = '/album/2f2Ik9JeinFVWZuFb3i35b';
  const report = playing => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(
          playing ? 'spotify:playing' : 'spotify:not-playing');
    }
  };
  const visible = element => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return !element.disabled && rect.width > 0 && rect.height > 0;
  };
  const ensureRepeatOne = () => {
    const repeat = document.querySelector(
        'button[data-testid="control-button-repeat"]');
    if (!repeat || repeat.getAttribute('aria-checked') === 'mixed') return;
    repeat.click();
    window.setTimeout(() => {
      const current = document.querySelector(
          'button[data-testid="control-button-repeat"]');
      if (current && current.getAttribute('aria-checked') !== 'mixed') {
        current.click();
      }
    }, 300);
  };
  const ensure = () => {
    if (location.hostname !== 'open.spotify.com') {
      report(false);
      return;
    }
    if (!location.pathname.endsWith(targetPath)) {
      report(false);
      location.replace(targetUrl);
      return;
    }
    const playButton = document.querySelector('button[data-testid="play-button"]');
    let playing = false;
    if (playButton) {
      const label = (playButton.getAttribute('aria-label') || '').toLowerCase();
      playing = label.includes('pause') || label.includes('一時停止');
      if (!playing && visible(playButton)) {
        playButton.click();
        window.setTimeout(ensure, 1500);
      }
    }
    ensureRepeatOne();
    report(playing);
  };
  ensure();
  window.setInterval(ensure, 60000);
})();
)JS";

constexpr wchar_t kSpotifyPodcastPlaybackScript[] = LR"JS(
(() => {
  if (window.__homePanelSakuraTalkAboutPlayback) return;
  window.__homePanelSakuraTalkAboutPlayback = true;
  const showUrl = 'https://open.spotify.com/show/2ZQy2mlwQodabAILwZ02Ed';
  const showPath = '/show/2ZQy2mlwQodabAILwZ02Ed';
  const playbackRate = 3.0;
  const report = playing => {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage(
          playing ? 'spotify:playing' : 'spotify:not-playing');
    }
  };
  const visible = element => {
    if (!element || element.disabled) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           rect.width > 0 && rect.height > 0;
  };
  const isPlayingButton = button => {
    const label = (button.getAttribute('aria-label') || '').toLowerCase();
    return label.includes('pause') || label.includes('一時停止');
  };
  const ensurePlaybackRate = () => {
    document.querySelectorAll('audio, video').forEach(media => {
      try {
        media.defaultPlaybackRate = playbackRate;
        if (media.playbackRate !== playbackRate) media.playbackRate = playbackRate;
      } catch (_) {
      }
    });
  };
  const disableRepeat = () => {
    const repeat = document.querySelector(
        'button[data-testid="control-button-repeat"]');
    if (!repeat) return;
    const state = repeat.getAttribute('aria-checked');
    if (state === 'true' || state === 'mixed') repeat.click();
  };
  const latestEpisodeButton = () => {
    const links = Array.from(document.querySelectorAll('a[href*="/episode/"]'))
        .filter(visible);
    if (links.length) {
      const latest = links[0];
      const container = latest.closest(
          '[data-testid="episode-item"], [data-testid="episode-row"], '
          + '[role="row"], li') || latest.parentElement?.parentElement;
      const button = container?.querySelector('button[data-testid="play-button"]');
      if (visible(button)) return button;
    }
    return Array.from(document.querySelectorAll(
        'button[data-testid="play-button"]')).find(visible) || null;
  };
  const ensure = () => {
    if (location.hostname !== 'open.spotify.com') {
      report(false);
      return;
    }
    const onShow = location.pathname.endsWith(showPath);
    const onEpisode = location.pathname.startsWith('/episode/');
    if (!onShow && !onEpisode) {
      report(false);
      location.replace(showUrl);
      return;
    }
    ensurePlaybackRate();
    disableRepeat();
    const playButtons = Array.from(document.querySelectorAll(
        'button[data-testid="play-button"]'));
    const playing = playButtons.some(isPlayingButton);
    if (!playing) {
      const playButton = onShow ? latestEpisodeButton() :
          playButtons.find(visible) || null;
      if (playButton) {
        playButton.click();
        window.setTimeout(ensure, 1500);
      }
    }
    report(playing);
  };
  ensure();
  window.setInterval(ensure, 5000);
})();
)JS";

std::wstring BuildSpotifyPanelLabelScript(size_t index) {
  if (index >= kSpotifyPanelNames.size()) return {};
  std::wstring script = LR"JS(
(() => {
  const mount = () => {
    if (document.getElementById('__homePanelSpotifyAccount')) return;
    const badge = document.createElement('div');
    badge.id = '__homePanelSpotifyAccount';
    badge.textContent = ')JS";
  script.append(kSpotifyPanelNames[index]);
  script += LR"JS(';
    badge.style.cssText =
        'position:fixed;left:8px;top:8px;z-index:2147483647;' +
        'padding:4px 7px;border-radius:4px;background:rgba(0,0,0,.78);' +
        'color:#fff;font:600 14px/1.2 "Segoe UI",sans-serif;pointer-events:none;';
    (document.body || document.documentElement).appendChild(badge);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  } else {
    mount();
  }
})();
)JS";
  return script;
}

void SetSpotifyOutputMuted(const ComPtr<ICoreWebView2>& webview) noexcept {
  if (!webview) return;
  ComPtr<ICoreWebView2_8> audio;
  if (SUCCEEDED(webview.As(&audio)) && audio) {
    audio->put_IsMuted(TRUE);
  }
}

bool StartsWithInsensitive(std::wstring_view value,
                           std::wstring_view prefix) noexcept {
  if (value.size() < prefix.size()) return false;
  for (size_t i = 0; i < prefix.size(); ++i) {
    if (towlower(value[i]) != towlower(prefix[i])) return false;
  }
  return true;
}
}  // namespace

SpotifyWebViews::SpotifyWebViews(HWND parentWindow, fs::path dataDir)
    : parentWindow_(parentWindow),
      userDataFolder_(std::move(dataDir) / L"webview2-youtube-mv") {
  for (size_t i = 0; i < slots_.size(); ++i) {
    slots_[i].owner = this;
    slots_[i].index = i;
  }
}

SpotifyWebViews::~SpotifyWebViews() { Shutdown(); }

bool SpotifyWebViews::EnsureHostClass() noexcept {
  static std::once_flag once;
  static bool registered = false;
  try {
    std::call_once(once, [] {
      WNDCLASSW windowClass{};
      windowClass.lpfnWndProc = &SpotifyWebViews::HostWndProc;
      windowClass.hInstance = GetModuleHandleW(nullptr);
      windowClass.lpszClassName = kSpotifyHostClass;
      windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
      windowClass.hbrBackground =
          static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
      SetLastError(ERROR_SUCCESS);
      registered = RegisterClassW(&windowClass) != 0 ||
                   GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
    });
  } catch (...) {
    return false;
  }
  return registered;
}

bool SpotifyWebViews::CreateHost(Slot& slot) noexcept {
  if (slot.hostWindow && IsWindow(slot.hostWindow)) return true;
  if (!parentWindow_ || !IsWindow(parentWindow_) || !EnsureHostClass()) return false;
  slot.hostWindow = CreateWindowExW(
      0, kSpotifyHostClass, L"Spotify", WS_CHILD | WS_CLIPSIBLINGS,
      0, 0, 1, 1, parentWindow_, nullptr, GetModuleHandleW(nullptr), &slot);
  return slot.hostWindow && IsWindow(slot.hostWindow);
}

void SpotifyWebViews::Start() noexcept {
  if (started_ || !parentWindow_ || !IsWindow(parentWindow_)) return;
  started_ = true;
  foreground_ = true;
  podcastMode_ = false;
  alive_->store(true, std::memory_order_release);

  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    slot.playing = false;
    slot.playerPage = false;
    if (!CreateHost(slot)) continue;
    if (i == 0) {
      CreateController(slot);
      continue;
    }
    const UINT delay = static_cast<UINT>(i) * kSpotifyStartupStaggerMs;
    if (SetTimer(slot.hostWindow, kSpotifyStartupTimer, delay, nullptr) == 0) {
      CreateController(slot);
    }
  }
  ArmModeTimer();
  Resize();
}

void SpotifyWebViews::CreateController(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) || slot.controller) return;
  const auto alive = alive_;
  Slot* const target = &slot;
  try {
    SharedWebViewEnvironment::Instance().Acquire(
        userDataFolder_, false, false,
        [this, alive, target](HRESULT result,
                              ICoreWebView2Environment* environment) {
          if (!alive->load(std::memory_order_acquire) || FAILED(result) ||
              !environment || !target->hostWindow || !IsWindow(target->hostWindow)) {
            return;
          }
          target->environment = environment;
          const auto ready =
              Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                  [this, alive, target](HRESULT controllerResult,
                                        ICoreWebView2Controller* controller)
                      -> HRESULT {
                    if (!alive->load(std::memory_order_acquire)) {
                      if (controller) controller->Close();
                      return S_OK;
                    }
                    if (FAILED(controllerResult) || !controller ||
                        !target->hostWindow || !IsWindow(target->hostWindow)) {
                      if (controller) controller->Close();
                      return S_OK;
                    }
                    target->controller = controller;
                    target->controller->get_CoreWebView2(&target->webview);
                    if (!target->webview) {
                      target->controller->Close();
                      target->controller.Reset();
                      return S_OK;
                    }
                    Configure(*target);
                    return S_OK;
                  });

          if (target->index == 0) {
            environment->CreateCoreWebView2Controller(
                target->hostWindow, ready.Get());
            return;
          }
          ComPtr<ICoreWebView2Environment10> environment10;
          if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment10))) ||
              !environment10) return;
          ComPtr<ICoreWebView2ControllerOptions> options;
          if (FAILED(environment10->CreateCoreWebView2ControllerOptions(&options)) ||
              !options) return;
          const std::wstring profileName =
              std::wstring(kSpotifyProfilePrefix) +
              std::to_wstring(target->index + 1);
          if (FAILED(options->put_ProfileName(profileName.c_str())) ||
              FAILED(options->put_IsInPrivateModeEnabled(FALSE))) return;
          environment10->CreateCoreWebView2ControllerWithOptions(
              target->hostWindow, options.Get(), ready.Get());
        });
  } catch (...) {
  }
}

void SpotifyWebViews::Configure(Slot& slot) noexcept {
  if (!slot.controller || !slot.webview) return;
  try {
    SetSpotifyOutputMuted(slot.webview);
    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(slot.controller.As(&controller2)) && controller2) {
      COREWEBVIEW2_COLOR background{255, 0, 0, 0};
      controller2->put_DefaultBackgroundColor(background);
    }
    ComPtr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(slot.webview->get_Settings(&settings)) && settings) {
      settings->put_IsScriptEnabled(TRUE);
      settings->put_IsWebMessageEnabled(TRUE);
      settings->put_AreDefaultScriptDialogsEnabled(TRUE);
      settings->put_AreDefaultContextMenusEnabled(FALSE);
      settings->put_AreDevToolsEnabled(FALSE);
      settings->put_IsStatusBarEnabled(FALSE);
      settings->put_AreHostObjectsAllowed(FALSE);
      settings->put_IsZoomControlEnabled(FALSE);
      settings->put_IsBuiltInErrorPageEnabled(TRUE);
      ComPtr<ICoreWebView2Settings3> settings3;
      if (SUCCEEDED(settings.As(&settings3)) && settings3) {
        settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
      }
    }

    Slot* const target = &slot;
    const auto alive = alive_;
    slot.webview->AddWebResourceRequestedFilter(
        L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_IMAGE);
    slot.webview->AddWebResourceRequestedFilter(
        L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FONT);
    slot.webview->add_WebResourceRequested(
        Callback<ICoreWebView2WebResourceRequestedEventHandler>(
            [alive, target](ICoreWebView2*,
                            ICoreWebView2WebResourceRequestedEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !args ||
                  !target->playerPage || !target->environment) return S_OK;
              ComPtr<ICoreWebView2WebResourceResponse> response;
              if (SUCCEEDED(target->environment->CreateWebResourceResponse(
                      nullptr, 204, L"No Content",
                      L"Cache-Control: no-store\r\n", &response)) && response) {
                args->put_Response(response.Get());
              }
              return S_OK;
            }).Get(),
        &slot.webResourceRequestedToken);

    slot.webview->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this, alive, target](ICoreWebView2*,
                                  ICoreWebView2NavigationStartingEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !args) return S_OK;
              target->playing = false;
              target->playerPage = false;
              LPWSTR rawUri = nullptr;
              if (SUCCEEDED(args->get_Uri(&rawUri)) && rawUri) {
                target->playerPage = IsSpotifyPlayerUri(rawUri);
                CoTaskMemFree(rawUri);
              }
              RecomputeForeground();
              return S_OK;
            }).Get(),
        &slot.navigationStartingToken);

    slot.webview->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this, alive, target](ICoreWebView2* sender,
                                  ICoreWebView2NavigationCompletedEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !sender || !args) {
                return S_OK;
              }
              SetSpotifyOutputMuted(target->webview);
              BOOL success = FALSE;
              if (FAILED(args->get_IsSuccess(&success)) || !success) {
                target->playing = false;
                target->playerPage = false;
                RecomputeForeground();
                return S_OK;
              }
              bool playerPage = false;
              LPWSTR rawUri = nullptr;
              if (SUCCEEDED(sender->get_Source(&rawUri)) && rawUri) {
                playerPage = IsSpotifyPlayerUri(rawUri);
                target->playing = false;
                target->playerPage = playerPage;
                CoTaskMemFree(rawUri);
                RecomputeForeground();
              }
              const std::wstring labelScript =
                  BuildSpotifyPanelLabelScript(target->index);
              if (!labelScript.empty()) sender->ExecuteScript(labelScript.c_str(), nullptr);
              if (playerPage) {
                sender->ExecuteScript(
                    podcastMode_ ? kSpotifyPodcastPlaybackScript
                                 : kSpotifyPlaybackScript,
                    nullptr);
              }
              return S_OK;
            }).Get(),
        &slot.navigationCompletedToken);

    slot.webview->add_WebMessageReceived(
        Callback<ICoreWebView2WebMessageReceivedEventHandler>(
            [this, alive, target](ICoreWebView2* sender,
                                  ICoreWebView2WebMessageReceivedEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !sender || !args) {
                return S_OK;
              }
              LPWSTR rawUri = nullptr;
              bool playerPage = false;
              if (SUCCEEDED(sender->get_Source(&rawUri)) && rawUri) {
                playerPage = IsSpotifyPlayerUri(rawUri);
                CoTaskMemFree(rawUri);
              }
              if (!playerPage) return S_OK;
              LPWSTR rawMessage = nullptr;
              if (FAILED(args->TryGetWebMessageAsString(&rawMessage)) || !rawMessage) {
                return S_OK;
              }
              bool recognized = true;
              bool playing = false;
              if (wcscmp(rawMessage, L"spotify:playing") == 0) {
                playing = true;
              } else if (wcscmp(rawMessage, L"spotify:not-playing") != 0) {
                recognized = false;
              }
              CoTaskMemFree(rawMessage);
              if (recognized && target->playing != playing) {
                target->playing = playing;
                RecomputeForeground();
              }
              return S_OK;
            }).Get(),
        &slot.webMessageReceivedToken);

    RECT client{};
    GetClientRect(slot.hostWindow, &client);
    slot.controller->put_Bounds(client);
    slot.controller->put_IsVisible(foreground_ ? TRUE : FALSE);
    slot.webview->Navigate(podcastMode_ ? kSpotifyPodcastLoginUrl
                                       : kSpotifyLoginUrl);
  } catch (...) {
  }
}

bool SpotifyWebViews::IsSpotifyPlayerUri(const wchar_t* uri) noexcept {
  if (!uri) return false;
  const std::wstring_view value(uri);
  return StartsWithInsensitive(value, L"https://open.spotify.com/") &&
         !StartsWithInsensitive(value, L"https://open.spotify.com/login");
}

void SpotifyWebViews::ArmModeTimer() noexcept {
  if (slots_.empty()) return;
  HWND host = slots_[0].hostWindow;
  if (!host || !IsWindow(host)) return;
  KillTimer(host, kSpotifyModeTimer);
  SetTimer(host, kSpotifyModeTimer, kSpotifyModePhaseMs, nullptr);
}

void SpotifyWebViews::ToggleMode() noexcept {
  if (!started_) return;
  podcastMode_ = !podcastMode_;
  for (Slot& slot : slots_) NavigateSlotToCurrentMode(slot);
  RecomputeForeground();
  ArmModeTimer();
}

void SpotifyWebViews::NavigateSlotToCurrentMode(Slot& slot) noexcept {
  slot.playing = false;
  if (slot.webview) {
    SetSpotifyOutputMuted(slot.webview);
    slot.webview->Navigate(podcastMode_ ? kSpotifyPodcastUrl : kSpotifyAlbumUrl);
  }
}

void SpotifyWebViews::RecomputeForeground() noexcept {
  bool foreground = false;
  for (const Slot& slot : slots_) foreground = foreground || !slot.playing;
  SetForeground(foreground);
}

void SpotifyWebViews::SetForeground(bool foreground) noexcept {
  if (foreground_ == foreground) return;
  foreground_ = foreground;
  PlaceHosts(foreground);
}

void SpotifyWebViews::Resize() noexcept { PlaceHosts(foreground_); }

void SpotifyWebViews::PlaceHosts(bool foreground) noexcept {
  if (!parentWindow_ || !IsWindow(parentWindow_)) return;
  RECT client{};
  GetClientRect(parentWindow_, &client);
  const int clientWidth = std::max(1L, client.right - client.left);
  const int clientHeight = std::max(1L, client.bottom - client.top);
  const int maxColumnWidth =
      std::max(1, clientWidth / static_cast<int>(kAccountCount));
  const int phoneWidth =
      std::max(1, std::min(maxColumnWidth, clientHeight * 9 / 20));
  const int phoneHeight =
      std::max(1, std::min(clientHeight, phoneWidth * 20 / 9));
  const int groupWidth = phoneWidth * static_cast<int>(kAccountCount);
  const int startX = client.left + (clientWidth - groupWidth) / 2;
  const int top = client.top + (clientHeight - phoneHeight) / 2;

  HDWP batch = BeginDeferWindowPos(static_cast<int>(kAccountCount));
  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    if (!slot.hostWindow || !IsWindow(slot.hostWindow)) continue;
    if (slot.controller) {
      slot.controller->put_IsVisible(foreground ? TRUE : FALSE);
    }
    if (!foreground) {
      ShowWindow(slot.hostWindow, SW_HIDE);
      continue;
    }
    ShowWindow(slot.hostWindow, SW_SHOWNOACTIVATE);
    if (batch) {
      batch = DeferWindowPos(
          batch, slot.hostWindow, HWND_TOP,
          startX + static_cast<int>(i) * phoneWidth, top,
          phoneWidth, phoneHeight, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    } else {
      SetWindowPos(slot.hostWindow, HWND_TOP,
                   startX + static_cast<int>(i) * phoneWidth, top,
                   phoneWidth, phoneHeight, SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
  }
  if (batch) EndDeferWindowPos(batch);
}

void SpotifyWebViews::CloseSlot(Slot& slot) noexcept {
  if (slot.hostWindow && IsWindow(slot.hostWindow)) {
    KillTimer(slot.hostWindow, kSpotifyStartupTimer);
    if (slot.index == 0) KillTimer(slot.hostWindow, kSpotifyModeTimer);
  }
  if (slot.webview) {
    if (slot.navigationStartingToken.value != 0) {
      slot.webview->remove_NavigationStarting(slot.navigationStartingToken);
    }
    if (slot.navigationCompletedToken.value != 0) {
      slot.webview->remove_NavigationCompleted(slot.navigationCompletedToken);
    }
    if (slot.webMessageReceivedToken.value != 0) {
      slot.webview->remove_WebMessageReceived(slot.webMessageReceivedToken);
    }
    if (slot.webResourceRequestedToken.value != 0) {
      slot.webview->remove_WebResourceRequested(slot.webResourceRequestedToken);
    }
  }
  slot.navigationStartingToken = {};
  slot.navigationCompletedToken = {};
  slot.webMessageReceivedToken = {};
  slot.webResourceRequestedToken = {};
  slot.webview.Reset();
  if (slot.controller) slot.controller->Close();
  slot.controller.Reset();
  slot.environment.Reset();
  if (slot.hostWindow && IsWindow(slot.hostWindow)) DestroyWindow(slot.hostWindow);
  slot.hostWindow = nullptr;
  slot.playing = false;
  slot.playerPage = false;
}

void SpotifyWebViews::Shutdown() noexcept {
  if (!started_) return;
  started_ = false;
  alive_->store(false, std::memory_order_release);
  for (Slot& slot : slots_) CloseSlot(slot);
  foreground_ = true;
  podcastMode_ = false;
}

LRESULT CALLBACK SpotifyWebViews::HostWndProc(
    HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  Slot* slot = reinterpret_cast<Slot*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    slot = reinterpret_cast<Slot*>(create->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(slot));
  }
  if (slot) {
    if (message == WM_TIMER && wparam == kSpotifyStartupTimer) {
      KillTimer(hwnd, kSpotifyStartupTimer);
      if (slot->owner) slot->owner->CreateController(*slot);
      return 0;
    }
    if (message == WM_TIMER && wparam == kSpotifyModeTimer && slot->index == 0) {
      if (slot->owner) slot->owner->ToggleMode();
      return 0;
    }
    if (message == WM_SIZE && slot->controller) {
      RECT client{};
      GetClientRect(hwnd, &client);
      slot->controller->put_Bounds(client);
      return 0;
    }
    if (message == WM_NCDESTROY) {
      if (slot->hostWindow == hwnd) slot->hostWindow = nullptr;
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
    }
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

}  // namespace hp
