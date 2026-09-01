#include "spotify_webviews.h"
#include "shared_webview_environment.h"

namespace hp {
namespace {
constexpr wchar_t kSpotifyHostClass[] = L"HomePanelSpotifyWebView";
constexpr wchar_t kSpotifyLoginUrl[] =
    L"https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2Falbum%2F2f2Ik9JeinFVWZuFb3i35b";
constexpr wchar_t kSpotifyProfilePrefix[] = L"spotify-";
constexpr std::array<std::wstring_view, 6> kSpotifyPanelNames = {
    L"amazon", L"yuukiar", L"ten", L"nagi", L"hinata", L"ozeki"};
constexpr wchar_t kSpotifyPlaybackScript[] = LR"JS(
(() => {
  if (window.__homePanelLonesomeRabbitLoop) return;
  window.__homePanelLonesomeRabbitLoop = true;

  const targetUrl = 'https://open.spotify.com/album/2f2Ik9JeinFVWZuFb3i35b';
  const targetPath = '/album/2f2Ik9JeinFVWZuFb3i35b';
  const ensure = () => {
    if (location.hostname !== 'open.spotify.com') return;
    if (!location.pathname.endsWith(targetPath)) {
      location.replace(targetUrl);
      return;
    }

    const playButton =
        document.querySelector('button[data-testid="play-button"]');
    if (playButton) {
      const label = (playButton.getAttribute('aria-label') || '').toLowerCase();
      const isPauseAction =
          label.includes('pause') || label.includes('一時停止');
      if (!isPauseAction) playButton.click();
    }

    const repeatButton = document.querySelector(
        'button[data-testid="control-button-repeat"]');
    if (repeatButton && repeatButton.getAttribute('aria-checked') !== 'mixed') {
      repeatButton.click();
    }
  };

  ensure();
  window.setInterval(ensure, 1000);
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
      // Intentionally use the exact same UDF as the existing YouTube MV WebView.
      // Named WebView2 profiles isolate the six Spotify sessions while all seven
      // controls share one WebView2 browser environment/process family.
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
  if (!parentWindow_ || !IsWindow(parentWindow_) || !EnsureHostClass()) {
    return false;
  }
  slot.hostWindow = CreateWindowExW(
      0, kSpotifyHostClass, L"Spotify", WS_CHILD | WS_CLIPSIBLINGS,
      0, 0, 1, 1, parentWindow_, nullptr, GetModuleHandleW(nullptr), &slot);
  return slot.hostWindow && IsWindow(slot.hostWindow);
}

void SpotifyWebViews::Start() noexcept {
  if (started_ || !parentWindow_ || !IsWindow(parentWindow_)) return;
  started_ = true;
  alive_->store(true, std::memory_order_release);

  for (Slot& slot : slots_) {
    if (!CreateHost(slot)) continue;
    CreateController(slot);
  }
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
          if (!alive->load(std::memory_order_acquire) ||
              FAILED(result) || !environment || !target->hostWindow ||
              !IsWindow(target->hostWindow)) {
            return;
          }

          ComPtr<ICoreWebView2Environment10> environment10;
          if (FAILED(environment->QueryInterface(IID_PPV_ARGS(&environment10))) ||
              !environment10) {
            return;
          }

          ComPtr<ICoreWebView2ControllerOptions> options;
          if (FAILED(environment10->CreateCoreWebView2ControllerOptions(&options)) ||
              !options) {
            return;
          }
          const std::wstring profileName =
              std::wstring(kSpotifyProfilePrefix) +
              std::to_wstring(target->index + 1);
          if (FAILED(options->put_ProfileName(profileName.c_str())) ||
              FAILED(options->put_IsInPrivateModeEnabled(FALSE))) {
            return;
          }

          const auto controllerReady =
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

          environment10->CreateCoreWebView2ControllerWithOptions(
              target->hostWindow, options.Get(), controllerReady.Get());
        });
  } catch (...) {
  }
}

void SpotifyWebViews::Configure(Slot& slot) noexcept {
  if (!slot.controller || !slot.webview) return;
  try {
    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(slot.controller.As(&controller2)) && controller2) {
      COREWEBVIEW2_COLOR background{255, 0, 0, 0};
      controller2->put_DefaultBackgroundColor(background);
    }

    ComPtr<ICoreWebView2Settings> settings;
    if (SUCCEEDED(slot.webview->get_Settings(&settings)) && settings) {
      settings->put_IsScriptEnabled(TRUE);
      settings->put_IsWebMessageEnabled(FALSE);
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
    slot.webview->add_NavigationStarting(
        Callback<ICoreWebView2NavigationStartingEventHandler>(
            [this, alive, target](
                ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args)
                -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !args) return S_OK;
              LPWSTR rawUri = nullptr;
              if (SUCCEEDED(args->get_Uri(&rawUri)) && rawUri) {
                target->authNavigation = IsSpotifyAuthUri(rawUri);
                CoTaskMemFree(rawUri);
                RecomputeAuthenticationForeground();
              }
              return S_OK;
            }).Get(),
        &slot.navigationStartingToken);

    slot.webview->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this, alive, target](
                ICoreWebView2* sender,
                ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || !sender || !args) {
                return S_OK;
              }
              BOOL success = FALSE;
              if (FAILED(args->get_IsSuccess(&success)) || !success) return S_OK;
              bool injectPlayback = false;
              LPWSTR rawUri = nullptr;
              if (SUCCEEDED(sender->get_Source(&rawUri)) && rawUri) {
                const bool authUri = IsSpotifyAuthUri(rawUri);
                const bool playerUri = IsSpotifyPlayerUri(rawUri);
                if (authUri) {
                  target->authNavigation = true;
                } else if (playerUri) {
                  target->authNavigation = false;
                  injectPlayback = true;
                }
                CoTaskMemFree(rawUri);
                RecomputeAuthenticationForeground();
              }

              const std::wstring labelScript =
                  BuildSpotifyPanelLabelScript(target->index);
              if (!labelScript.empty()) {
                sender->ExecuteScript(labelScript.c_str(), nullptr);
              }
              if (injectPlayback) {
                sender->ExecuteScript(kSpotifyPlaybackScript, nullptr);
              }
              return S_OK;
            }).Get(),
        &slot.navigationCompletedToken);

    RECT client{};
    GetClientRect(slot.hostWindow, &client);
    slot.controller->put_Bounds(client);
    slot.controller->put_IsVisible(TRUE);

    // Opening the login endpoint makes an expired/new profile surface itself.
    // Authenticated profiles continue directly to the one-track official
    // Lonesome rabbit release, which the injected player script starts and
    // keeps in repeat-one mode.
    slot.webview->Navigate(kSpotifyLoginUrl);
  } catch (...) {
  }
}

bool SpotifyWebViews::IsSpotifyAuthUri(const wchar_t* uri) noexcept {
  if (!uri) return false;
  const std::wstring_view value(uri);
  return StartsWithInsensitive(value, L"https://accounts.spotify.com/") ||
         StartsWithInsensitive(value, L"https://www.spotify.com/login") ||
         StartsWithInsensitive(value, L"https://open.spotify.com/login");
}

bool SpotifyWebViews::IsSpotifyPlayerUri(const wchar_t* uri) noexcept {
  if (!uri) return false;
  return StartsWithInsensitive(std::wstring_view(uri),
                               L"https://open.spotify.com/");
}

void SpotifyWebViews::RecomputeAuthenticationForeground() noexcept {
  bool foreground = false;
  for (const Slot& slot : slots_) {
    foreground = foreground || slot.authNavigation;
  }
  SetAuthenticationForeground(foreground);
}

void SpotifyWebViews::SetAuthenticationForeground(bool foreground) noexcept {
  if (authenticationForeground_ == foreground) return;
  authenticationForeground_ = foreground;
  PlaceHosts(foreground);
}

void SpotifyWebViews::Resize() noexcept {
  PlaceHosts(authenticationForeground_);
}

void SpotifyWebViews::PlaceHosts(bool foreground) noexcept {
  if (!parentWindow_ || !IsWindow(parentWindow_)) return;
  RECT client{};
  GetClientRect(parentWindow_, &client);
  const int clientWidth = std::max(1L, client.right - client.left);
  const int clientHeight = std::max(1L, client.bottom - client.top);
  const int maxColumnWidth = std::max(1, clientWidth / static_cast<int>(kAccountCount));
  const int phoneWidth = std::max(1, std::min(maxColumnWidth, clientHeight * 9 / 20));
  const int phoneHeight = std::max(1, std::min(clientHeight, phoneWidth * 20 / 9));
  const int groupWidth = phoneWidth * static_cast<int>(kAccountCount);
  const int startX = client.left + (clientWidth - groupWidth) / 2;
  const int top = client.top + (clientHeight - phoneHeight) / 2;

  HDWP batch = BeginDeferWindowPos(static_cast<int>(kAccountCount));
  for (size_t i = 0; i < slots_.size(); ++i) {
    Slot& slot = slots_[i];
    if (!slot.hostWindow || !IsWindow(slot.hostWindow)) continue;
    if (!foreground) {
      ShowWindow(slot.hostWindow, SW_HIDE);
      continue;
    }
    ShowWindow(slot.hostWindow, SW_SHOWNOACTIVATE);
    if (batch) {
      batch = DeferWindowPos(
          batch, slot.hostWindow, HWND_TOP,
          startX + static_cast<int>(i) * phoneWidth, top,
          phoneWidth, phoneHeight,
          SWP_NOACTIVATE | SWP_SHOWWINDOW);
    } else {
      SetWindowPos(slot.hostWindow, HWND_TOP,
                   startX + static_cast<int>(i) * phoneWidth, top,
                   phoneWidth, phoneHeight,
                   SWP_NOACTIVATE | SWP_SHOWWINDOW);
    }
  }
  if (batch) EndDeferWindowPos(batch);
}

void SpotifyWebViews::CloseSlot(Slot& slot) noexcept {
  if (slot.webview) {
    if (slot.navigationStartingToken.value != 0) {
      slot.webview->remove_NavigationStarting(slot.navigationStartingToken);
    }
    if (slot.navigationCompletedToken.value != 0) {
      slot.webview->remove_NavigationCompleted(slot.navigationCompletedToken);
    }
  }
  slot.navigationStartingToken = {};
  slot.navigationCompletedToken = {};
  slot.webview.Reset();
  if (slot.controller) slot.controller->Close();
  slot.controller.Reset();
  if (slot.hostWindow && IsWindow(slot.hostWindow)) DestroyWindow(slot.hostWindow);
  slot.hostWindow = nullptr;
  slot.authNavigation = false;
}

void SpotifyWebViews::Shutdown() noexcept {
  if (!started_) return;
  started_ = false;
  alive_->store(false, std::memory_order_release);
  for (Slot& slot : slots_) CloseSlot(slot);
  authenticationForeground_ = false;
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
