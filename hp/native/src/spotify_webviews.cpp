#include "spotify_webviews.h"
#include "shared_webview_environment.h"

namespace hp {
namespace {
constexpr wchar_t kSpotifyHostClass[] = L"HomePanelSpotifyWebView";
constexpr wchar_t kSpotifyPlaylistUrl[] =
    L"https://open.spotify.com/album/2f2Ik9JeinFVWZuFb3i35b";
constexpr wchar_t kSpotifyPodcastUrl[] =
    L"https://open.spotify.com/show/2ZQy2mlwQodabAILwZ02Ed";
constexpr wchar_t kSpotifyLoginUrl[] =
    L"https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2Falbum%2F2f2Ik9JeinFVWZuFb3i35b";
constexpr wchar_t kSpotifyProfilePrefix[] = L"spotify-";

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
      // One UDF keeps the browser process family shared. Named profiles below
      // isolate cookies/local storage for every Spotify account.
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
  robustSchedulerStarted_ = false;
  staggerSlotIndex_ = 0;
  staggerSlotStartTick_ = 0;
  youtubeCycleStartTick_ = 0;
  staggerSlotValidated_ = false;
  hostLayoutMask_ = ~0u;
  hostLayoutActiveSlot_ = kAccountCount;
  hostLayoutAuthenticationVisible_ = false;
  alive_->store(true, std::memory_order_release);

  for (Slot& slot : slots_) {
    slot.playing = false;
    slot.playerPage = false;
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
    if (!CreateHost(slot)) continue;
  }

  // Controller creation is serialized. Slot 0 starts immediately; the single
  // stagger scheduler creates slots 1-5 when their 40-second turn arrives.
  if (!slots_.empty() && slots_[0].hostWindow) {
    CreateController(slots_[0]);
  }
  Resize();
}

void SpotifyWebViews::CreateController(Slot& slot) noexcept {
  if (!slot.hostWindow || !IsWindow(slot.hostWindow) ||
      slot.controller || slot.webview) {
    return;
  }
  slot.controllerCreating = true;
  slot.controllerCreateTick = GetTickCount64();
  const auto alive = alive_;
  Slot* const target = &slot;
  try {
    SharedWebViewEnvironment::Instance().Acquire(
        userDataFolder_, false, false,
        [this, alive, target](HRESULT result,
                              ICoreWebView2Environment* environment) {
          if (!alive->load(std::memory_order_acquire)) return;
          if (FAILED(result) || !environment || !target->hostWindow ||
              !IsWindow(target->hostWindow)) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            return;
          }
          target->environment = environment;

          ComPtr<ICoreWebView2Environment10> environment10;
          if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment10))) ||
              !environment10) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            return;
          }
          ComPtr<ICoreWebView2ControllerOptions> options;
          if (FAILED(environment10->CreateCoreWebView2ControllerOptions(&options)) ||
              !options) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            return;
          }
          const std::wstring profileName =
              std::wstring(kSpotifyProfilePrefix) +
              std::to_wstring(target->index + 1);
          if (FAILED(options->put_ProfileName(profileName.c_str())) ||
              FAILED(options->put_IsInPrivateModeEnabled(FALSE))) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
            return;
          }

          const auto ready =
              Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                  [this, alive, target](HRESULT controllerResult,
                                        ICoreWebView2Controller* controller)
                      -> HRESULT {
                    if (!alive->load(std::memory_order_acquire)) {
                      if (controller) controller->Close();
                      return S_OK;
                    }
                    target->controllerCreating = false;
                    target->controllerCreateTick = 0;
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

          const HRESULT createResult =
              environment10->CreateCoreWebView2ControllerWithOptions(
                  target->hostWindow, options.Get(), ready.Get());
          if (FAILED(createResult)) {
            target->controllerCreating = false;
            target->controllerCreateTick = 0;
          }
        });
  } catch (...) {
    slot.controllerCreating = false;
    slot.controllerCreateTick = 0;
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
                  !target->playerPage || !target->environment) {
                return S_OK;
              }
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

              LPWSTR rawUri = nullptr;
              bool playerPage = false;
              if (SUCCEEDED(sender->get_Source(&rawUri)) && rawUri) {
                playerPage = IsSpotifyPlayerUri(rawUri);
                CoTaskMemFree(rawUri);
              }
              target->playing = false;
              target->playerPage = playerPage;
              RecomputeForeground();
              if (!playerPage) return S_OK;

              const HRESULT bootstrap = sender->ExecuteScript(
                  kSpotifyStaticPageBootstrapScript,
                  Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
                      [this, alive, target](HRESULT result, LPCWSTR) -> HRESULT {
                        if (!alive->load(std::memory_order_acquire) ||
                            FAILED(result) || !started_ || !target->webview) {
                          return S_OK;
                        }
                        PostSpotifyPageContext(*target);
                        return S_OK;
                      }).Get());
              if (FAILED(bootstrap)) target->playing = false;
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
    // Keeping WebView2 visible avoids background suspension. The HWND itself is
    // parked outside the dashboard when this slot does not own recovery.
    slot.controller->put_IsVisible(TRUE);
    slot.webview->Navigate(kSpotifyLoginUrl);
  } catch (...) {
  }
}

bool SpotifyWebViews::IsSpotifyPlayerUri(const wchar_t* uri) noexcept {
  if (!uri) return false;
  const std::wstring_view value(uri);
  return StartsWithInsensitive(value, L"https://open.spotify.com/") &&
         !StartsWithInsensitive(value, L"https://open.spotify.com/login");
}

void SpotifyWebViews::RecomputeForeground() noexcept {
  bool foreground = false;
  for (const Slot& slot : slots_) foreground = foreground || !slot.playing;
  foreground_ = foreground;
  RefreshSpotifyHostLayout();
}

void SpotifyWebViews::SetForeground(bool foreground) noexcept {
  foreground_ = foreground;
  RefreshSpotifyHostLayout();
}

void SpotifyWebViews::Resize() noexcept {
  hostLayoutMask_ = ~0u;
  hostLayoutActiveSlot_ = kAccountCount;
  hostLayoutAuthenticationVisible_ = false;
  RefreshSpotifyHostLayout();
}

void SpotifyWebViews::PlaceHosts(bool foreground) noexcept {
  (void)foreground;
  if (!parentWindow_ || !IsWindow(parentWindow_) || slots_.empty()) return;

  RECT client{};
  if (!GetClientRect(parentWindow_, &client)) return;
  const int clientWidth = std::max(1L, client.right - client.left);
  const int clientHeight = std::max(1L, client.bottom - client.top);
  const int activeWidth = std::max(1, clientWidth * 3 / 5);
  const int activeHeight = std::max(1, clientHeight * 9 / 10);
  const int activeIndex = static_cast<int>(staggerSlotIndex_ % slots_.size());

  HDWP batch = BeginDeferWindowPos(static_cast<int>(slots_.size()));
  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    if (!slot.hostWindow || !IsWindow(slot.hostWindow)) continue;
    if (slot.controller) slot.controller->put_IsVisible(TRUE);

    const bool active = static_cast<int>(i) == activeIndex;
    const bool authentication = active && SlotIsLoginPage(slot);
    const bool recovery = active && !authentication && !slot.playing;

    int x = client.right + 8 + static_cast<int>(i);
    int y = client.top;
    int width = 1;
    int height = 1;
    HWND insertAfter = HWND_BOTTOM;
    if (authentication) {
      x = client.left + (clientWidth - activeWidth) / 2;
      y = client.top + (clientHeight - activeHeight) / 2;
      width = activeWidth;
      height = activeHeight;
      insertAfter = HWND_TOP;
    } else if (recovery) {
      // Give only the current owner a normal CSS viewport, but keep it offscreen.
      x = client.right + 32;
      y = client.top + (clientHeight - activeHeight) / 2;
      width = activeWidth;
      height = activeHeight;
    }

    ShowWindow(slot.hostWindow, SW_SHOWNOACTIVATE);
    const UINT flags = SWP_NOACTIVATE | SWP_SHOWWINDOW;
    if (batch) {
      batch = DeferWindowPos(batch, slot.hostWindow, insertAfter,
                             x, y, width, height, flags);
    } else {
      SetWindowPos(slot.hostWindow, insertAfter,
                   x, y, width, height, flags);
    }
  }
  if (batch) EndDeferWindowPos(batch);

  for (Slot& slot : slots_) {
    if (!slot.hostWindow || !IsWindow(slot.hostWindow) || !slot.controller) {
      continue;
    }
    RECT bounds{};
    GetClientRect(slot.hostWindow, &bounds);
    slot.controller->put_Bounds(bounds);
    slot.controller->NotifyParentWindowPositionChanged();
    slot.controller->put_IsVisible(TRUE);
  }
}

void SpotifyWebViews::CloseSlot(Slot& slot) noexcept {
  if (slot.index == 0 && slot.hostWindow && IsWindow(slot.hostWindow)) {
    KillTimer(slot.hostWindow, kSpotifyRobustReconcileTimer);
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
    if (slot.timedEndMessageReceivedToken.value != 0) {
      slot.webview->remove_WebMessageReceived(slot.timedEndMessageReceivedToken);
    }
  }
  slot.navigationStartingToken = {};
  slot.navigationCompletedToken = {};
  slot.webMessageReceivedToken = {};
  slot.webResourceRequestedToken = {};
  slot.timedEndMessageReceivedToken = {};
  slot.timedEndHandlerWebview = nullptr;
  slot.webview.Reset();
  if (slot.controller) slot.controller->Close();
  slot.controller.Reset();
  slot.environment.Reset();
  if (slot.hostWindow && IsWindow(slot.hostWindow)) DestroyWindow(slot.hostWindow);
  slot.hostWindow = nullptr;
  slot.controllerCreating = false;
  slot.controllerCreateTick = 0;
  slot.reconcileInFlight = false;
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
  robustSchedulerStarted_ = false;
  staggerSlotIndex_ = 0;
  staggerSlotStartTick_ = 0;
  youtubeCycleStartTick_ = 0;
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
