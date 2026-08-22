namespace {
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMvPanelPageUrl[] = L"https://homepanel.mv/index.html";
constexpr wchar_t kNativeMvPanelVirtualHost[] = L"homepanel.mv";

constexpr char kNativeMvPanelHtml[] = R"HTML(<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>櫻坂46 MV</title>
<style>
html,body,#player{width:100%;height:100%;margin:0;background:#000;overflow:hidden}
body{font-family:"Segoe UI","Yu Gothic UI",sans-serif}
#player{position:absolute;inset:0}
#source{position:absolute;z-index:3;left:12px;top:10px;padding:5px 9px;border-radius:999px;
  color:#fff;background:rgba(0,0,0,.62);font-size:12px;line-height:1;pointer-events:none}
#resume{position:absolute;z-index:4;inset:0;margin:auto;width:max-content;height:max-content;
  padding:10px 16px;border:1px solid rgba(255,255,255,.35);border-radius:999px;
  color:#fff;background:rgba(0,0,0,.78);font:600 14px "Segoe UI","Yu Gothic UI",sans-serif;cursor:pointer}
#resume[hidden]{display:none}
</style>
</head>
<body>
<div id="player"></div>
<div id="source">櫻坂チャンネル</div>
<button id="resume" hidden>再生</button>
<script>
(() => {
  'use strict';
  const SOURCES = [
    { label: '櫻坂チャンネル', playlist: 'UUDNDlqJRz4FsO_ByfUNOSuQ' },
    { label: '櫻坂46 MUSIC VIDEO', playlist: 'PL0eK3gfF1BbM6tiu8UThzL9nYNowS8LL2' },
  ];
  const sourceBadge = document.getElementById('source');
  const resumeButton = document.getElementById('resume');
  let player = null;
  let currentSource = 0;
  let pendingPlaylist = false;
  let playlistWaitAttempts = 0;
  let consecutiveErrors = 0;
  const previousIndex = [-1, -1];

  function randomIndex(count, previous) {
    if (count <= 1) return 0;
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    let index = random[0] % count;
    if (index === previous) {
      crypto.getRandomValues(random);
      index = (index + 1 + (random[0] % (count - 1))) % count;
    }
    return index;
  }

  function showResume() {
    resumeButton.hidden = false;
  }

  function hideResume() {
    resumeButton.hidden = true;
  }

  function playRandomFromCurrentPlaylist() {
    if (!player) return;
    const playlist = player.getPlaylist() || [];
    if (!playlist.length) {
      if (++playlistWaitAttempts <= 20) {
        setTimeout(playRandomFromCurrentPlaylist, 250);
        return;
      }
      pendingPlaylist = false;
      playlistWaitAttempts = 0;
      loadSource(1 - currentSource);
      return;
    }

    pendingPlaylist = false;
    playlistWaitAttempts = 0;
    const index = randomIndex(playlist.length, previousIndex[currentSource]);
    previousIndex[currentSource] = index;
    player.playVideoAt(index);
  }

  function loadSource(sourceIndex) {
    if (!player) return;
    currentSource = sourceIndex;
    pendingPlaylist = true;
    playlistWaitAttempts = 0;
    sourceBadge.textContent = SOURCES[currentSource].label;
    player.cuePlaylist({
      listType: 'playlist',
      list: SOURCES[currentSource].playlist,
      index: 0,
    });
  }

  function onStateChange(event) {
    if (event.data === YT.PlayerState.CUED && pendingPlaylist) {
      playRandomFromCurrentPlaylist();
      return;
    }
    if (event.data === YT.PlayerState.PLAYING) {
      consecutiveErrors = 0;
      hideResume();
      return;
    }
    if (event.data === YT.PlayerState.ENDED) {
      loadSource(1 - currentSource);
    }
  }

  function onPlayerError() {
    ++consecutiveErrors;
    if (consecutiveErrors >= 4) {
      consecutiveErrors = 0;
      loadSource(1 - currentSource);
      return;
    }
    pendingPlaylist = false;
    playRandomFromCurrentPlaylist();
  }

  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('player', {
      width: '100%',
      height: '100%',
      playerVars: {
        autoplay: 1,
        controls: 1,
        disablekb: 0,
        fs: 0,
        iv_load_policy: 3,
        playsinline: 1,
        rel: 0,
        origin: location.origin,
      },
      events: {
        onReady: () => loadSource(0),
        onStateChange,
        onError: onPlayerError,
        onAutoplayBlocked: showResume,
      },
    });
  };

  resumeButton.addEventListener('click', () => {
    hideResume();
    if (!player) return;
    if (pendingPlaylist) playRandomFromCurrentPlaylist();
    else player.playVideo();
  });
  document.addEventListener('contextmenu', event => event.preventDefault());

  const api = document.createElement('script');
  api.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(api);
})();
</script>
</body>
</html>)HTML";

LRESULT CALLBACK NativeMvPanelWndProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);

class NativeMvPanelHost {
 public:
  explicit NativeMvPanelHost(const fs::path& dataDir)
      : userDataFolder_(dataDir / L"webview2-youtube-mv"),
        assetFolder_(dataDir / L"mv-player"),
        alive_(std::make_shared<std::atomic<bool>>(true)) {}

  void Attach(HWND hwnd) noexcept { hostWindow_ = hwnd; }

  void Start() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_) || !PreparePlayerHtml()) {
      failed_ = true;
      InvalidateRect(hostWindow_, nullptr, FALSE);
      return;
    }

    const auto alive = alive_;
    try {
      SharedWebViewEnvironment::Instance().Acquire(
          userDataFolder_, false, false,
          [this, alive](HRESULT result, ICoreWebView2Environment* environment) {
            if (!alive->load(std::memory_order_acquire)) return;
            if (FAILED(result) || !environment || !hostWindow_ || !IsWindow(hostWindow_)) {
              Fail();
              return;
            }
            environment_ = environment;
            const auto controllerReady =
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [this, alive](HRESULT controllerResult,
                                  ICoreWebView2Controller* controller) -> HRESULT {
                      if (!alive->load(std::memory_order_acquire)) {
                        if (controller) controller->Close();
                        return S_OK;
                      }
                      if (FAILED(controllerResult) || !controller) {
                        if (controller) controller->Close();
                        Fail();
                        return S_OK;
                      }
                      controller_ = controller;
                      controller_->get_CoreWebView2(&webview_);
                      if (!webview_) {
                        Fail();
                        return S_OK;
                      }
                      Configure();
                      return S_OK;
                    });
            const HRESULT started = environment_->CreateCoreWebView2Controller(
                hostWindow_, controllerReady.Get());
            if (FAILED(started)) Fail();
          });
    } catch (...) {
      Fail();
    }
  }

  void Resize() noexcept {
    if (!hostWindow_ || !controller_) return;
    RECT client{};
    GetClientRect(hostWindow_, &client);
    if (client.right <= client.left || client.bottom <= client.top) return;
    controller_->put_Bounds(client);
  }

  void Paint() noexcept {
    PAINTSTRUCT paint{};
    HDC dc = BeginPaint(hostWindow_, &paint);
    if (!dc) return;
    RECT client{};
    GetClientRect(hostWindow_, &client);
    FillRect(dc, &client, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
    if (failed_) {
      SetBkMode(dc, TRANSPARENT);
      SetTextColor(dc, RGB(220, 225, 232));
      DrawTextW(dc, L"MVを読み込めません", -1, &client,
                DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
    }
    EndPaint(hostWindow_, &paint);
  }

  void Shutdown() noexcept {
    alive_->store(false, std::memory_order_release);
    if (controller_) {
      controller_->put_IsVisible(FALSE);
      controller_->Close();
    }
    webview_.Reset();
    controller_.Reset();
    environment_.Reset();
    hostWindow_ = nullptr;
  }

 private:
  bool PreparePlayerHtml() noexcept {
    try {
      std::error_code error;
      fs::create_directories(assetFolder_, error);
      if (error) return false;
      const fs::path indexPath = assetFolder_ / L"index.html";
      std::ofstream output(indexPath, std::ios::binary | std::ios::trunc);
      if (!output) return false;
      output.write(kNativeMvPanelHtml,
                   static_cast<std::streamsize>(sizeof(kNativeMvPanelHtml) - 1));
      output.flush();
      return output.good();
    } catch (...) {
      return false;
    }
  }

  void Configure() noexcept {
    try {
      ComPtr<ICoreWebView2Settings> settings;
      if (SUCCEEDED(webview_->get_Settings(&settings)) && settings) {
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_IsZoomControlEnabled(FALSE);
      }

      ComPtr<ICoreWebView2_3> webview3;
      if (FAILED(webview_.As(&webview3)) || !webview3 ||
          FAILED(webview3->SetVirtualHostNameToFolderMapping(
              kNativeMvPanelVirtualHost, assetFolder_.c_str(),
              COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS))) {
        Fail();
        return;
      }

      Resize();
      controller_->put_IsVisible(TRUE);
      if (FAILED(webview_->Navigate(kNativeMvPanelPageUrl))) {
        Fail();
      }
    } catch (...) {
      Fail();
    }
  }

  void Fail() noexcept {
    failed_ = true;
    if (controller_) controller_->put_IsVisible(FALSE);
    if (hostWindow_ && IsWindow(hostWindow_)) InvalidateRect(hostWindow_, nullptr, FALSE);
  }

  HWND hostWindow_ = nullptr;
  fs::path userDataFolder_;
  fs::path assetFolder_;
  std::shared_ptr<std::atomic<bool>> alive_;
  ComPtr<ICoreWebView2Environment> environment_;
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
  bool failed_ = false;
};

LRESULT CALLBACK NativeMvPanelWndProc(
    HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  NativeMvPanelHost* host =
      reinterpret_cast<NativeMvPanelHost*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    host = static_cast<NativeMvPanelHost*>(create->lpCreateParams);
    if (host) {
      host->Attach(hwnd);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(host));
    }
  }

  if (host) {
    switch (message) {
      case WM_SIZE:
        host->Resize();
        return 0;
      case WM_ERASEBKGND:
        return 1;
      case WM_PAINT:
        host->Paint();
        return 0;
      case WM_NCDESTROY:
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        host->Shutdown();
        delete host;
        return DefWindowProcW(hwnd, message, wparam, lparam);
      default:
        break;
    }
  }
  return DefWindowProcW(hwnd, message, wparam, lparam);
}

bool EnsureNativeMvPanel(HWND parentWindow, const fs::path& dataDir,
                         const RECT& bounds) noexcept {
  if (!parentWindow || !IsWindow(parentWindow) ||
      bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return false;
  }

  static std::once_flag classOnce;
  static bool classReady = false;
  std::call_once(classOnce, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = NativeMvPanelWndProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kNativeMvPanelHostClass;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    SetLastError(ERROR_SUCCESS);
    classReady = RegisterClassW(&windowClass) != 0 ||
        GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  });
  if (!classReady) return false;

  HWND host = FindWindowExW(parentWindow, nullptr, kNativeMvPanelHostClass, nullptr);
  if (!host) {
    NativeMvPanelHost* state = nullptr;
    try {
      state = new NativeMvPanelHost(dataDir);
    } catch (...) {
      return false;
    }
    host = CreateWindowExW(
        0, kNativeMvPanelHostClass, L"", WS_CHILD | WS_CLIPCHILDREN |
            WS_CLIPSIBLINGS | WS_VISIBLE,
        bounds.left, bounds.top, std::max(1L, bounds.right - bounds.left),
        std::max(1L, bounds.bottom - bounds.top), parentWindow, nullptr,
        GetModuleHandleW(nullptr), state);
    if (!host) {
      delete state;
      return false;
    }
    state->Start();
    return true;
  }

  RECT current{};
  GetWindowRect(host, &current);
  MapWindowPoints(nullptr, parentWindow, reinterpret_cast<POINT*>(&current), 2);
  if (!EqualRect(&current, &bounds)) {
    SetWindowPos(host, HWND_TOP, bounds.left, bounds.top,
                 std::max(1L, bounds.right - bounds.left),
                 std::max(1L, bounds.bottom - bounds.top),
                 SWP_NOACTIVATE | SWP_NOSENDCHANGING | SWP_SHOWWINDOW);
  }
  return true;
}
}  // namespace

void Renderer::DrawMusicSection(HDC dc, const RECT& card) {
  DrawSectionCard(dc, card);
  const int width = std::max(1L, card.right - card.left);
  const int height = std::max(1L, card.bottom - card.top);
  const int inset = std::max(2, std::min(width, height) * 8 / 1000);
  const RECT playerBounds =
      NormalizeInsetRect(card, inset, inset, inset, inset);
  EnsureNativeMvPanel(nativeMainWindow_, dataDir_, playerBounds);

  // Stationhead remains available for its existing data/recovery paths during
  // this migration, but the MV panel is now the audible media surface.
  static bool stationheadMuteQueued = false;
  if (!stationheadMuteQueued) {
    stationheadMuteQueued = true;
    QueueAction(UiAction::StationheadAudioMute);
  }
}
