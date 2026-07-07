  bool EnsureWindow() {
    if (window_ && IsWindow(window_)) return true;
    static std::once_flag classOnce;
    std::call_once(classOnce, [] {
      WNDCLASSEXW windowClass{sizeof(windowClass)};
      windowClass.lpfnWndProc = WindowProc;
      windowClass.hInstance = GetModuleHandleW(nullptr);
      windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
      windowClass.hbrBackground = reinterpret_cast<HBRUSH>(GetStockObject(WHITE_BRUSH));
      windowClass.lpszClassName = kWindowClassName;
      RegisterClassExW(&windowClass);
    });
    RECT workArea{0, 0, 1000, 900};
    HMONITOR monitor = MonitorFromWindow(ownerWindow_, MONITOR_DEFAULTTOPRIMARY);
    MONITORINFO monitorInfo{sizeof(monitorInfo)};
    if (GetMonitorInfoW(monitor, &monitorInfo)) workArea = monitorInfo.rcWork;
    const int width = std::min(1000L, std::max(720L, workArea.right - workArea.left));
    const int height = std::min(1000L, std::max(640L, workArea.bottom - workArea.top));
    const int left = workArea.left + (workArea.right - workArea.left - width) / 2;
    const int top = workArea.top + (workArea.bottom - workArea.top - height) / 2;
    window_ = CreateWindowExW(
        WS_EX_TOOLWINDOW, kWindowClassName, L"mineo マイページ自動化",
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
        left, top, width, height, ownerWindow_, nullptr,
        GetModuleHandleW(nullptr), this);
    if (window_ && IsWindow(window_)) ShowWindow(window_, SW_HIDE);
    return window_ && IsWindow(window_);
  }

  void EnsureStarted() {
    if (webview_ || creating_ || stopping_) return;
    if (!EnsureWindow()) {
      log_.Warn(L"mineo automation window creation failed");
      return;
    }
    creating_ = true;
    callbackAlive_->store(false, std::memory_order_release);
    callbackAlive_ = std::make_shared<std::atomic<bool>>(true);
    const auto alive = callbackAlive_;
    SharedWebViewEnvironment::Instance().Acquire(
        sharedDataFolder_,
        [this, alive](HRESULT result, ICoreWebView2Environment* environment) {
          if (!alive->load(std::memory_order_acquire) || stopping_) return;
          if (FAILED(result) || !environment) {
            creating_ = false;
            log_.Warn(L"mineo WebView2 environment unavailable " + HResultHex(result));
            return;
          }
          environment_ = environment;
          ComPtr<ICoreWebView2Environment10> environment10;
          if (FAILED(environment_.As(&environment10)) || !environment10) {
            creating_ = false;
            log_.Warn(L"mineo WebView2 profile API unavailable");
            return;
          }
          ComPtr<ICoreWebView2ControllerOptions> options;
          const HRESULT optionsResult = environment10->CreateCoreWebView2ControllerOptions(options.GetAddressOf());
          if (FAILED(optionsResult) || !options) {
            creating_ = false;
            log_.Warn(L"mineo WebView2 profile options failed " + HResultHex(optionsResult));
            return;
          }
          options->put_ProfileName(kProfileName);
          options->put_IsInPrivateModeEnabled(FALSE);
          const HRESULT started = environment10->CreateCoreWebView2ControllerWithOptions(
              window_, options.Get(),
              Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                  [this, alive](HRESULT controllerResult, ICoreWebView2Controller* controller) -> HRESULT {
                    creating_ = false;
                    if (!alive->load(std::memory_order_acquire) || stopping_) {
                      if (controller) controller->Close();
                      return S_OK;
                    }
                    if (FAILED(controllerResult) || !controller) {
                      log_.Warn(L"mineo WebView2 controller failed " + HResultHex(controllerResult));
                      return S_OK;
                    }
                    controller_ = controller;
                    controller_->get_CoreWebView2(&webview_);
                    if (!webview_) {
                      controller_->Close();
                      controller_.Reset();
                      log_.Warn(L"mineo WebView2 instance unavailable");
                      return S_OK;
                    }
                    ConfigureWebView();
                    return S_OK;
                  }).Get());
          if (FAILED(started)) {
            creating_ = false;
            log_.Warn(L"mineo WebView2 controller start failed " + HResultHex(started));
          }
        });
  }

  void ConfigureWebView() {
    ComPtr<ICoreWebView2Settings> settings;
    webview_->get_Settings(&settings);
    if (settings) {
      settings->put_AreDefaultContextMenusEnabled(FALSE);
      settings->put_AreDevToolsEnabled(FALSE);
      settings->put_IsStatusBarEnabled(FALSE);
      settings->put_IsZoomControlEnabled(FALSE);
    }
    ComPtr<ICoreWebView2Controller2> controller2;
    if (SUCCEEDED(controller_.As(&controller2)) && controller2) {
      controller2->put_DefaultBackgroundColor(COREWEBVIEW2_COLOR{255, 255, 255, 255});
    }
    controller_->put_IsVisible(FALSE);
    LayoutController();
    const auto alive = callbackAlive_;
    webview_->add_NavigationCompleted(
        Callback<ICoreWebView2NavigationCompletedEventHandler>(
            [this, alive](ICoreWebView2*, ICoreWebView2NavigationCompletedEventArgs* args) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || stopping_) return S_OK;
              BOOL success = FALSE;
              if (args) args->get_IsSuccess(&success);
              navigating_ = false;
              nextProbeAt_ = UnixMillis() + 1'000;
              if (!success) {
                log_.Warn(L"mineo MyPage navigation failed");
              } else if (scheduledActive_ || loginRequired_) {
                CaptureDomSnapshot(L"navigation-completed");
              }
              return S_OK;
            }).Get(), &navigationToken_);
    webview_->add_NewWindowRequested(
        Callback<ICoreWebView2NewWindowRequestedEventHandler>(
            [this, alive](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || stopping_ || !args) return S_OK;
              LPWSTR raw = nullptr;
              args->get_Uri(&raw);
              const std::wstring uri = raw ? raw : L"";
              if (raw) CoTaskMemFree(raw);
              args->put_Handled(TRUE);
              if (!uri.empty() && webview_) {
                navigating_ = true;
                webview_->Navigate(uri.c_str());
              }
              return S_OK;
            }).Get(), &newWindowToken_);
    webview_->add_ProcessFailed(
        Callback<ICoreWebView2ProcessFailedEventHandler>(
            [this, alive](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) -> HRESULT {
              if (!alive->load(std::memory_order_acquire) || stopping_) return S_OK;
              log_.Warn(L"mineo WebView2 process failed");
              return S_OK;
            }).Get(), &processFailedToken_);
    navigating_ = true;
    webview_->Navigate(config_.url.c_str());
    HideWindow();
  }

  void CaptureDomSnapshot(const std::wstring& reason) {
    if (!webview_ || domCapturePending_) return;
    const int64_t now = UnixMillis();
    if (now - lastDomCaptureAt_ < kDomCaptureThrottleMs) return;
    domCapturePending_ = true;
    const auto alive = callbackAlive_;
    const wchar_t* script = LR"JS((() => {
      const safeUrl = `${location.origin}${location.pathname}`;
      if (location.hostname !== 'my.mineo.jp') {
        return { url: safeUrl, html: '', skipped: true };
      }
      const clone = document.documentElement?.cloneNode(true);
      if (!clone) return { url: safeUrl, html: '', skipped: false };
      clone.querySelectorAll('script,style,noscript').forEach(node => node.remove());
      clone.querySelectorAll('input,textarea,select,option').forEach(element => {
        element.removeAttribute('value');
        element.removeAttribute('checked');
        element.removeAttribute('selected');
        if ('value' in element) element.value = '';
        if (element.tagName === 'TEXTAREA') element.textContent = '';
      });
      clone.querySelectorAll('*').forEach(element => {
        for (const attribute of Array.from(element.attributes || [])) {
          const name = attribute.name.toLowerCase();
          if (name.startsWith('on') ||
              ['href', 'action', 'formaction', 'srcdoc'].includes(name) ||
              /token|secret|session|auth/i.test(name)) {
            element.removeAttribute(attribute.name);
          }
        }
      });
      clone.querySelectorAll('iframe').forEach(element => element.removeAttribute('src'));
      const redactDirectText = selector => {
        clone.querySelectorAll(selector).forEach(element => {
          for (const node of Array.from(element.childNodes)) {
            if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
              node.textContent = '[redacted]';
            }
          }
        });
      };
      redactDirectText('#box_user2 strong, #profile01 dd, .goribanSelectBox-col-1');
      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        node.textContent = String(node.textContent || '')
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
          .replace(/(?:\+81[-\s]?|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/g, '[redacted-phone]')
          .replace(/\b\d{10,11}\b/g, '[redacted-number]');
      }
      clone.setAttribute('data-homepanel-redacted', 'true');
      return { url: safeUrl, html: clone.outerHTML, skipped: false };
    })())JS";
    webview_->ExecuteScript(
        script,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive, reason](HRESULT result, LPCWSTR value) -> HRESULT {
              domCapturePending_ = false;
              if (!alive->load(std::memory_order_acquire) || stopping_) return S_OK;
              if (FAILED(result) || !value) {
                log_.Warn(L"mineo DOM snapshot failed");
                return S_OK;
              }
              try {
                const auto object = winrt::Windows::Data::Json::JsonObject::Parse(value);
                const bool skipped = object.GetNamedBoolean(L"skipped", false);
                if (skipped) return S_OK;
                const std::wstring url = object.GetNamedString(L"url", L"").c_str();
                const std::wstring html = object.GetNamedString(L"html", L"").c_str();
                if (html.empty()) {
                  log_.Warn(L"mineo DOM snapshot was empty");
                  return S_OK;
                }
                std::error_code cleanupError;
                fs::remove(dataDir_ / L"mineo-dom-login-id.html", cleanupError);
                cleanupError.clear();
                fs::remove(dataDir_ / L"mineo-dom-login-password.html", cleanupError);
                const fs::path filename = dataDir_ / L"mineo-dom-current.html";
                AtomicWriteText(filename, WideToUtf8(L"<!-- captured-url: " + url + L" -->\n" + html));
                AtomicWriteText(dataDir_ / L"mineo-dom-reason.txt", WideToUtf8(reason));
                lastDomCaptureAt_ = UnixMillis();
                log_.Info(L"mineo DOM snapshot saved: " + filename.filename().wstring() + L" reason=" + reason);
              } catch (...) {
                log_.Warn(L"mineo DOM snapshot decode failed");
              }
              return S_OK;
            }).Get());
  }

  void LayoutController() {
    if (!controller_ || !window_ || !IsWindow(window_)) return;
    RECT client{};
    GetClientRect(window_, &client);
    controller_->put_Bounds(client);
  }

  void ShowWindowIfReady() {
    if (!window_ || !IsWindow(window_)) return;
    if (controller_) controller_->put_IsVisible(TRUE);
    ShowWindow(window_, SW_SHOWNA);
  }

  void HideWindow() {
    if (controller_) controller_->put_IsVisible(FALSE);
    if (window_ && IsWindow(window_)) ShowWindow(window_, SW_HIDE);
  }
