namespace {
constexpr wchar_t kNativeMvPanelHostClass[] = L"HomePanelNativeMvPanel";
constexpr wchar_t kNativeMvPanelPageUrl[] = L"https://homepanel.mv/index.html";
constexpr wchar_t kNativeMvPanelVirtualHost[] = L"homepanel.mv";
constexpr char kNativeMvPanelHtml[] = R"HTML(<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>MV</title>
<style>
*{box-sizing:border-box}
html,body{width:100%;height:100%;margin:0;background:#000;overflow:hidden}
#mv{position:absolute;z-index:1;inset:0;width:100%;height:100%;border:0}
#waste{position:absolute;z-index:2;top:12px;right:12px;width:min(62%,720px);padding:8px;
  border:1px solid rgba(255,255,255,.28);border-radius:10px;background:rgba(8,10,14,.90);
  color:#fff;font-family:"Segoe UI","Yu Gothic UI",sans-serif;opacity:.42;pointer-events:none}
#waste-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 2px 6px;
  font-size:clamp(9px,1.25vw,13px);font-weight:600;line-height:1.1}
#waste-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.waste-day{min-width:0;padding:5px 2px;border:1px solid rgba(255,255,255,.20);border-radius:7px;
  background:rgba(255,255,255,.08);text-align:center;line-height:1.1}
.waste-day.today{border-color:rgba(255,255,255,.62);background:rgba(255,255,255,.18)}
.waste-date{display:block;font-size:clamp(8px,1.1vw,12px);font-weight:600;white-space:nowrap}
.waste-kind{display:flex;align-items:center;justify-content:center;min-height:2.25em;margin-top:3px;
  font-size:clamp(7px,1vw,11px);font-weight:600;overflow-wrap:anywhere}
</style>
</head>
<body>
<iframe id="mv"
  src="https://www.youtube.com/embed/videoseries?list=PLMWqSdpIVl30&autoplay=1&loop=1&controls=1&playsinline=1&rel=0&iv_load_policy=3&fs=0"
  referrerpolicy="strict-origin-when-cross-origin"
  allow="autoplay; encrypted-media; picture-in-picture"
  title="MV playlist"></iframe>
<div id="waste" aria-hidden="true">
  <div id="waste-head"><span>ごみ収集カレンダー</span><span>コース36</span></div>
  <div id="waste-grid"></div>
</div>
<script>
(() => {
  'use strict';
  const schedule = __COURSE36_SCHEDULE__;
  const labels = [
    '回収なし', '年度外', '可燃ごみ', 'プラ製容器・包装',
    'びん・かん・ペット', '不燃・有害', '布類', '紙類'
  ];
  const weekdays = ['日','月','火','水','木','金','土'];
  const grid = document.getElementById('waste-grid');
  const dateKey = date => date.getFullYear() * 10000 +
      (date.getMonth() + 1) * 100 + date.getDate();

  function renderWaste() {
    const now = new Date();
    const todayKey = dateKey(now);
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    grid.replaceChildren();
    for (let index = 0; index < 7; ++index) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      const key = dateKey(date);
      const kind = key < 20260401 || key > 20270331 ? 1 : (schedule[key] ?? 0);
      const cell = document.createElement('div');
      cell.className = 'waste-day' + (key === todayKey ? ' today' : '');
      const dateLine = document.createElement('span');
      dateLine.className = 'waste-date';
      dateLine.textContent = weekdays[date.getDay()] + ' ' +
          (date.getMonth() + 1) + '/' + date.getDate();
      const kindLine = document.createElement('span');
      kindLine.className = 'waste-kind';
      kindLine.textContent = labels[kind] || labels[0];
      cell.append(dateLine, kindLine);
      grid.append(cell);
    }
  }

  renderWaste();
  setInterval(renderWaste, 60_000);
})();
</script>
</body>
</html>)HTML";

std::string BuildCourse36WasteScheduleJson() {
  std::string json;
  json.reserve(6'000);
  json.push_back('{');

  SYSTEMTIME date{};
  date.wYear = 2026;
  date.wMonth = 4;
  date.wDayOfWeek = 3;
  date.wDay = 1;
  bool first = true;
  for (;;) {
    char entry[32]{};
    sprintf_s(entry, "\"%04u%02u%02u\":%u",
              static_cast<unsigned>(date.wYear),
              static_cast<unsigned>(date.wMonth),
              static_cast<unsigned>(date.wDay),
              static_cast<unsigned>(Course36WasteForDate(date)));
    if (!first) json.push_back(',');
    first = false;
    json += entry;
    if (Course36DateKey(date) >= 20270331) break;

    SYSTEMTIME next{};
    if (!Course36AddDays(date, 1, next)) return "{}";
    date = next;
  }

  json.push_back('}');
  return json;
}

LRESULT CALLBACK NativeMvPanelWndProc(HWND hwnd, UINT message, WPARAM wparam,
                                      LPARAM lparam);

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
      if (hostWindow_ && IsWindow(hostWindow_)) {
        InvalidateRect(hostWindow_, nullptr, FALSE);
      }
      return;
    }

    const auto alive = alive_;
    try {
      // The MV surface is video-only. Disable image downloads/decoding and
      // downloadable fonts at the browser environment level to keep the single
      // YouTube playback WebView as small as practical.
      SharedWebViewEnvironment::Instance().Acquire(
          userDataFolder_, true, true,
          [this, alive](HRESULT result, ICoreWebView2Environment* environment) {
            if (!alive->load(std::memory_order_acquire)) return;
            if (FAILED(result) || !environment || !hostWindow_ ||
                !IsWindow(hostWindow_)) {
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
      DrawTextW(dc, L"動画を読み込めません", -1, &client,
                DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX);
    }
    EndPaint(hostWindow_, &paint);
  }

  void Shutdown() noexcept {
    alive_->store(false, std::memory_order_release);
    if (webview_ && newWindowToken_.value != 0) {
      webview_->remove_NewWindowRequested(newWindowToken_);
      newWindowToken_ = {};
    }
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
      std::string html(kNativeMvPanelHtml);
      constexpr char kScheduleMarker[] = "__COURSE36_SCHEDULE__";
      const size_t marker = html.find(kScheduleMarker);
      if (marker == std::string::npos) return false;
      html.replace(marker, sizeof(kScheduleMarker) - 1,
                   BuildCourse36WasteScheduleJson());

      const fs::path indexPath = assetFolder_ / L"index.html";
      std::ofstream output(indexPath, std::ios::binary | std::ios::trunc);
      if (!output) return false;
      output.write(html.data(), static_cast<std::streamsize>(html.size()));
      output.flush();
      return output.good();
    } catch (...) {
      return false;
    }
  }

  void Configure() noexcept {
    try {
      ComPtr<ICoreWebView2Controller2> controller2;
      if (SUCCEEDED(controller_.As(&controller2)) && controller2) {
        COREWEBVIEW2_COLOR background{255, 0, 0, 0};
        controller2->put_DefaultBackgroundColor(background);
      }

      ComPtr<ICoreWebView2Settings> settings;
      if (SUCCEEDED(webview_->get_Settings(&settings)) && settings) {
        settings->put_IsScriptEnabled(TRUE);
        settings->put_IsWebMessageEnabled(FALSE);
        settings->put_AreDefaultScriptDialogsEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreHostObjectsAllowed(FALSE);
        settings->put_IsZoomControlEnabled(FALSE);
        settings->put_IsBuiltInErrorPageEnabled(FALSE);

        ComPtr<ICoreWebView2Settings3> settings3;
        if (SUCCEEDED(settings.As(&settings3)) && settings3) {
          settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
        }
      }

      const HRESULT newWindowResult = webview_->add_NewWindowRequested(
          Callback<ICoreWebView2NewWindowRequestedEventHandler>(
              [](ICoreWebView2*,
                 ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
                if (args) args->put_Handled(TRUE);
                return S_OK;
              }).Get(),
          &newWindowToken_);
      if (FAILED(newWindowResult)) newWindowToken_ = {};

      // YouTube explicitly requires an enclosing page/context for embedded
      // playback. Hosting the tiny wrapper on a local HTTPS virtual host makes
      // the iframe send a normal Referer instead of opening /embed/ directly.
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
    if (hostWindow_ && IsWindow(hostWindow_)) {
      InvalidateRect(hostWindow_, nullptr, FALSE);
    }
  }

  HWND hostWindow_ = nullptr;
  fs::path userDataFolder_;
  fs::path assetFolder_;
  std::shared_ptr<std::atomic<bool>> alive_;
  ComPtr<ICoreWebView2Environment> environment_;
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
  EventRegistrationToken newWindowToken_{};
  bool failed_ = false;
};

LRESULT CALLBACK NativeMvPanelWndProc(HWND hwnd, UINT message, WPARAM wparam,
                                      LPARAM lparam) {
  NativeMvPanelHost* host = reinterpret_cast<NativeMvPanelHost*>(
      GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    const auto* create = reinterpret_cast<CREATESTRUCTW*>(lparam);
    host = static_cast<NativeMvPanelHost*>(create->lpCreateParams);
    if (host) {
      host->Attach(hwnd);
      SetWindowLongPtrW(hwnd, GWLP_USERDATA,
                        reinterpret_cast<LONG_PTR>(host));
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
    windowClass.hbrBackground =
        static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    SetLastError(ERROR_SUCCESS);
    classReady = RegisterClassW(&windowClass) != 0 ||
                 GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  });
  if (!classReady) return false;

  HWND host =
      FindWindowExW(parentWindow, nullptr, kNativeMvPanelHostClass, nullptr);
  if (!host) {
    NativeMvPanelHost* state = nullptr;
    try {
      state = new NativeMvPanelHost(dataDir);
    } catch (...) {
      return false;
    }
    host = CreateWindowExW(
        0, kNativeMvPanelHostClass, L"",
        WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS | WS_VISIBLE,
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
  // The YouTube WebView occupies the upper native panel while this section is
  // the rain radar in the lower-left main column.
  if (nativeRadarWindow_ && IsWindow(nativeRadarWindow_)) {
    RECT mvBounds{};
    GetClientRect(nativeRadarWindow_, &mvBounds);
    if (mvBounds.right > mvBounds.left && mvBounds.bottom > mvBounds.top) {
      EnsureNativeMvPanel(nativeRadarWindow_, dataDir_, mvBounds);
    }
  }

  const RECT& bounds = card;
  const int radius = CardRadius(bounds);
  HRGN rounded = CreateRoundRectRgn(bounds.left, bounds.top, bounds.right + 1,
                                    bounds.bottom + 1, radius, radius);
  ExtSelectClipRgn(dc, rounded, RGN_AND);
  DeleteObject(rounded);

  bool hasFrame = false;
  std::wstring timeText;
  {
    std::lock_guard lock(radarFrameMutex_);
    hasFrame = radarFrameBitmap_ != nullptr;
    timeText = radarTimeText_;
    if (hasFrame) StretchRadarInto(dc, bounds, radarFrameBitmap_);
  }
  const bool noRain = hasFrame && timeText == L"しばらく雨は降りません";
  if (!hasFrame) {
    HBRUSH surface = CreateSolidBrush(kWidgetSurface);
    FillRect(dc, &bounds, surface);
    DeleteObject(surface);
    HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
    SetTextColor(dc, kWidgetMuted);
    DrawTextInRect(dc, L"レーダー画像を準備中", bounds,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    SelectObject(dc, previousFont);
  } else if (noRain) {
    FillRoundRectTranslucent(dc, bounds, RGB(0, 0, 0), radius, 165);
    const RECT messageBounds = NormalizeInsetRect(
        bounds, SpanX(bounds, 45), SpanY(bounds, 120),
        SpanX(bounds, 45), SpanY(bounds, 90));
    HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Large));
    SetTextColor(dc, kWidgetText);
    DrawTextInRect(dc, L"しばらく雨は降りません", messageBounds,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    SelectObject(dc, previousFont);
  }

  HGDIOBJ previousFont = SelectObject(dc, TierFont(FontTier::Small));
  const std::wstring chipText = noRain
      ? L"雨雲レーダー"
      : L"雨雲レーダー " + (timeText.empty() ? L"--:--" : timeText);
  RECT measure{};
  DrawTextW(dc, chipText.c_str(), -1, &measure,
            DT_CALCRECT | DT_SINGLELINE | DT_NOPREFIX);
  const int chipPadX = std::max(8, SpanX(bounds, 8));
  const int chipPadY = std::max(4, SpanY(bounds, 8));
  const int chipMargin = std::max(10, SpanY(bounds, 25));
  const RECT chip{bounds.left + chipMargin, bounds.top + chipMargin,
                  bounds.left + chipMargin + (measure.right - measure.left) + chipPadX * 2,
                  bounds.top + chipMargin + (measure.bottom - measure.top) + chipPadY * 2};
  FillRoundRectTranslucent(dc, chip, RGB(0, 0, 0), chip.bottom - chip.top, 150);
  SetTextColor(dc, kWidgetText);
  DrawTextInRect(dc, chipText, chip, DT_CENTER | DT_SINGLELINE | DT_VCENTER);
  SelectObject(dc, previousFont);

  SelectClipRgn(dc, nullptr);
  DrawCardOutline(dc, bounds, radius);

  static bool stationheadMuteQueued = false;
  if (!stationheadMuteQueued) {
    stationheadMuteQueued = true;
    QueueAction(UiAction::StationheadAudioMute);
  }
}