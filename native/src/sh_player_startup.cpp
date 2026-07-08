// Part of sh_player.cpp's translation unit (see the #include at the end of that
// file). Auto-play startup automation: scanning the Stationhead page for the
// "Start Listening" control, evaluating readiness/playback, and clicking it.
// Uses the kStartupScanScript / JsonStringResult helpers defined in sh_player.cpp.
#include "sh.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {

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

}  // namespace hp
