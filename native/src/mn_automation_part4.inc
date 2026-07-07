  void ExecuteProbe() {
    probePending_ = true;
    const auto alive = callbackAlive_;
    const std::wstring script = BuildProbeScript();
    webview_->ExecuteScript(
        script.c_str(),
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR value) -> HRESULT {
              probePending_ = false;
              if (!alive->load(std::memory_order_acquire) || stopping_) return S_OK;
              const int64_t now = UnixMillis();
              if (FAILED(result) || !value) {
                nextProbeAt_ = now + kUnknownRetryMs;
                log_.Warn(L"mineo page probe failed");
                CaptureDomSnapshot(L"probe-failed");
                return S_OK;
              }
              const std::wstring response(value);
              if (response.find(L"login-id-clicked") != std::wstring::npos) {
                loginRequired_ = false;
                nextProbeAt_ = now + kProbeRetryMs;
                log_.Info(L"mineo eoID entered; waiting for password page");
              } else if (response.find(L"login-password-clicked") != std::wstring::npos) {
                loginRequired_ = false;
                nextProbeAt_ = now + kProbeRetryMs;
                log_.Info(L"mineo password entered; waiting for login completion");
              } else if (response.find(L"login-id-required") != std::wstring::npos ||
                         response.find(L"login-password-required") != std::wstring::npos ||
                         response.find(L"login-id-submit-missing") != std::wstring::npos ||
                         response.find(L"login-password-submit-missing") != std::wstring::npos ||
                         response.find(L"login-required") != std::wstring::npos) {
                loginRequired_ = true;
                nextProbeAt_ = now + kUnknownRetryMs;
                const bool passwordPage = response.find(L"password") != std::wstring::npos;
                CaptureDomSnapshot(passwordPage ? L"login-password" : L"login-id");
                if (now - lastUnknownLogAt_ >= 5 * 60'000) {
                  lastUnknownLogAt_ = now;
                  log_.Warn(passwordPage
                      ? L"mineo password page requires credentials or selector inspection"
                      : L"mineo eoID page requires credentials or selector inspection");
                }
              } else if (response.find(L"data-clicked") != std::wstring::npos) {
                loginRequired_ = false;
                nextProbeAt_ = now + kProbeRetryMs;
                log_.Info(L"mineo data-saving switch clicked; waiting for confirmation");
              } else if (response.find(L"data-satisfied") != std::wstring::npos) {
                loginRequired_ = false;
                dataSatisfied_ = true;
                nextProbeAt_ = now + 1'000;
                log_.Info(scheduledMorning_
                    ? L"mineo 06:58 target confirmed: saving ON"
                    : L"mineo 22:58 target confirmed: saving OFF");
                FinishIfComplete();
              } else if (response.find(L"yuzu-clicked") != std::wstring::npos) {
                nextProbeAt_ = now + kProbeRetryMs;
                log_.Info(L"mineo yuzurune declaration clicked; waiting for confirmation");
              } else if (response.find(L"yuzu-satisfied") != std::wstring::npos) {
                yuzuSatisfied_ = true;
                log_.Info(L"mineo yuzurune declaration confirmed");
                FinishIfComplete();
              } else if (response.find(L"complete") != std::wstring::npos) {
                FinishIfComplete();
              } else {
                nextProbeAt_ = now + kUnknownRetryMs;
                CaptureDomSnapshot(response.find(L"yuzu-unknown") != std::wstring::npos
                    ? L"yuzu-unknown" : L"data-unknown");
                if (now - lastUnknownLogAt_ >= 5 * 60'000) {
                  lastUnknownLogAt_ = now;
                  log_.Warn(response.find(L"yuzu-unknown") != std::wstring::npos
                      ? L"mineo yuzurune button could not be identified; update yuzuReadyText or yuzuSelector"
                      : L"mineo data switch could not be identified; update dataSelector after inspecting MyPage");
                }
              }
              return S_OK;
            }).Get());
  }

  void FinishIfComplete() {
    if (!scheduledActive_) return;
    const bool complete = dataSatisfied_ && (!config_.yuzuEnabled || yuzuSatisfied_);
    if (!complete) return;
    if (scheduledMorning_) state_.morningDate = scheduledDate_;
    else state_.nightDate = scheduledDate_;
    if (config_.yuzuEnabled) state_.yuzuDate = scheduledDate_;
    SaveState();
    scheduledActive_ = false;
    loginRequired_ = false;
    nextProbeAt_ = 0;
    HideWindow();
    log_.Info(L"mineo scheduled automation completed");
  }

  void LoadState() {
    try {
      std::ifstream input(statePath_, std::ios::binary);
      const std::string text((std::istreambuf_iterator<char>(input)), {});
      if (text.empty()) return;
      const auto root = winrt::Windows::Data::Json::JsonObject::Parse(Utf8ToWide(text));
      state_.morningDate = static_cast<int>(root.GetNamedNumber(L"morningDate", 0));
      state_.nightDate = static_cast<int>(root.GetNamedNumber(L"nightDate", 0));
      state_.yuzuDate = static_cast<int>(root.GetNamedNumber(L"yuzuDate", 0));
      state_.setupShown = root.GetNamedBoolean(L"setupShown", false);
    } catch (...) {
      state_ = {};
    }
  }

  void SaveState() {
    winrt::Windows::Data::Json::JsonObject root;
    root.SetNamedValue(L"morningDate",
        winrt::Windows::Data::Json::JsonValue::CreateNumberValue(state_.morningDate));
    root.SetNamedValue(L"nightDate",
        winrt::Windows::Data::Json::JsonValue::CreateNumberValue(state_.nightDate));
    root.SetNamedValue(L"yuzuDate",
        winrt::Windows::Data::Json::JsonValue::CreateNumberValue(state_.yuzuDate));
    root.SetNamedValue(L"setupShown",
        winrt::Windows::Data::Json::JsonValue::CreateBooleanValue(state_.setupShown));
    AtomicWriteText(statePath_, WideToUtf8(root.Stringify().c_str()));
  }

  HWND ownerWindow_{};
  HWND window_{};
  fs::path sharedDataFolder_;
  fs::path dataDir_;
  fs::path statePath_;
  Logger& log_;
  MineoConfig config_;
  MineoCredentials credentials_;
  State state_;
  ComPtr<ICoreWebView2Environment> environment_;
  ComPtr<ICoreWebView2Controller> controller_;
  ComPtr<ICoreWebView2> webview_;
  EventRegistrationToken navigationToken_{};
  EventRegistrationToken newWindowToken_{};
  EventRegistrationToken processFailedToken_{};
  std::shared_ptr<std::atomic<bool>> callbackAlive_{std::make_shared<std::atomic<bool>>(true)};
  std::atomic<bool> stopping_{false};
  bool creating_ = false;
  bool navigating_ = false;
  bool probePending_ = false;
  bool domCapturePending_ = false;
  bool scheduledActive_ = false;
  bool scheduledMorning_ = false;
  bool dataSatisfied_ = false;
  bool yuzuSatisfied_ = false;
  bool loginRequired_ = false;
  int scheduledDate_ = 0;
  int64_t activeUntil_ = 0;
  int64_t nextProbeAt_ = 0;
  int64_t lastUnknownLogAt_ = 0;
  int64_t lastDomCaptureAt_ = 0;
};

std::unique_ptr<MineoAutomation> gMineoAutomation;
HWND gMineoOwner = nullptr;
fs::path gMineoDataFolder;

}  // namespace

void TickMineoAutomation(HWND ownerWindow, int64_t nowMs,
                         const fs::path& sharedWebViewDataFolder,
                         Logger& log) noexcept {
  try {
    if (!gMineoAutomation || gMineoOwner != ownerWindow ||
        gMineoDataFolder != sharedWebViewDataFolder) {
      gMineoAutomation.reset();
      gMineoOwner = ownerWindow;
      gMineoDataFolder = sharedWebViewDataFolder;
      gMineoAutomation = std::make_unique<MineoAutomation>(
          ownerWindow, sharedWebViewDataFolder, log);
    }
    gMineoAutomation->Tick(nowMs);
  } catch (const std::exception& error) {
    log.Warn(L"mineo automation tick failed: " + Utf8ToWide(error.what()));
  } catch (...) {
    log.Warn(L"mineo automation tick failed with an unknown error");
  }
}

void ShutdownMineoAutomation() noexcept {
  gMineoAutomation.reset();
  gMineoOwner = nullptr;
  gMineoDataFolder.clear();
}

}  // namespace hp
