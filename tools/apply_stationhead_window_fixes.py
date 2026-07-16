from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    print(f"{label}: {count}")
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


def replace_exact_count(text: str, old: str, new: str, expected: int, label: str) -> str:
    count = text.count(old)
    print(f"{label}: {count}")
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} matches, found {count}")
    return text.replace(old, new)


header_path = Path("native/src/sh.h")
header = header_path.read_text(encoding="utf-8")
header = replace_once(
    header,
    "  bool webViewConfigured_ = false;\n  bool startupScriptRegistrationComplete_ = false;\n",
    "  bool webViewConfigured_ = false;\n  bool authCaptureScriptRegistrationComplete_ = false;\n  bool startupScriptRegistrationComplete_ = false;\n",
    "add auth capture registration state",
)
header_path.write_text(header, encoding="utf-8")

cpp_path = Path("native/src/sh.cpp")
cpp = cpp_path.read_text(encoding="utf-8")
cpp = replace_once(
    cpp,
    "  if (!webViewConfigured_ || !startupScriptRegistrationComplete_ ||\n      startupNavigationStarted_ || shuttingDown_ || !webview_) {",
    "  if (!webViewConfigured_ || !authCaptureScriptRegistrationComplete_ ||\n      !startupScriptRegistrationComplete_ || startupNavigationStarted_ ||\n      shuttingDown_ || !webview_) {",
    "wait for both startup scripts",
)
cpp = replace_once(
    cpp,
    "    if (!startupScriptRegistrationComplete_ && startupScriptDeadline_ > 0 &&\n        nowMs >= startupScriptDeadline_) {\n      startupScriptRegistrationComplete_ = true;",
    "    if ((!authCaptureScriptRegistrationComplete_ ||\n         !startupScriptRegistrationComplete_) &&\n        startupScriptDeadline_ > 0 && nowMs >= startupScriptDeadline_) {\n      authCaptureScriptRegistrationComplete_ = true;\n      startupScriptRegistrationComplete_ = true;",
    "release both startup gates on timeout",
)
cpp_path.write_text(cpp, encoding="utf-8")

webview_path = Path("native/src/sh_webview.cpp")
webview = webview_path.read_text(encoding="utf-8")
webview = replace_exact_count(
    webview,
    "  webViewConfigured_ = false;\n  startupScriptRegistrationComplete_ = false;\n  startupNavigationStarted_ = false;",
    "  webViewConfigured_ = false;\n  authCaptureScriptRegistrationComplete_ = false;\n  startupScriptRegistrationComplete_ = false;\n  startupNavigationStarted_ = false;",
    2,
    "reset auth capture registration state",
)
webview = replace_once(
    webview,
    "  const HRESULT authCaptureResult =\n      webview_->AddScriptToExecuteOnDocumentCreated(authCaptureScript.c_str(), nullptr);\n  if (FAILED(authCaptureResult)) {\n    log_.Warn(L\"Stationhead \" + std::wstring(RoleTag()) +\n              L\" auth capture script registration failed \" + HResultHex(authCaptureResult));\n  }",
    "  const HRESULT authCaptureResult = webview_->AddScriptToExecuteOnDocumentCreated(\n      authCaptureScript.c_str(),\n      Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>(\n          [this, alive](HRESULT result, LPCWSTR) -> HRESULT {\n            if (!CallbackAlive(alive)) return S_OK;\n            if (FAILED(result)) {\n              log_.Warn(L\"Stationhead \" + std::wstring(RoleTag()) +\n                        L\" auth capture script registration failed \" + HResultHex(result));\n            }\n            authCaptureScriptRegistrationComplete_ = true;\n            TryStartInitialNavigation();\n            return S_OK;\n          }).Get());\n  if (FAILED(authCaptureResult)) {\n    log_.Warn(L\"Stationhead \" + std::wstring(RoleTag()) +\n              L\" auth capture script registration could not start \" +\n              HResultHex(authCaptureResult));\n    authCaptureScriptRegistrationComplete_ = true;\n  }",
    "wait for auth capture registration callback",
)
webview = replace_once(
    webview,
    "              if (type == L\"stationhead-auth-ready\") {\n                lastDailyPlayStatsAt_ = 0;\n                nextTickAt_ = 0;\n                return S_OK;\n              }",
    "              if (type == L\"stationhead-auth-ready\") {\n                loginRequired_ = false;\n                {\n                  std::lock_guard lock(mutex_);\n                  status_.loginRequired = false;\n                  status_.detail = L\"Stationhead authentication ready\";\n                }\n                if (IsSecondary()) {\n                  lastAuthProbeAt_ = 0;\n                  authProbeStartedAt_ = 0;\n                  authProbeInFlight_ = false;\n                } else {\n                  lastDailyPlayStatsAt_ = 0;\n                }\n                nextAutoClickAt_ = 0;\n                nextTickAt_ = 0;\n                PostChange();\n                return S_OK;\n              }",
    "clear login-required state on auth ready",
)
webview_path.write_text(webview, encoding="utf-8")

shared_path = Path("native/src/sh_shared.h")
shared = shared_path.read_text(encoding="utf-8")
shared = replace_once(
    shared,
    "    if (response.status === 401 || response.status === 403) {\n      window.__homepanelStationheadRejectedAuthorization = headers.authorization;\n      window.__homepanelStationheadAuthHeaders = null;\n      post({ type: 'stationhead-auth-probe', state: 'auth-failed', status: response.status });\n      return;\n    }\n    if (!response.ok) throw new Error('http-' + response.status);",
    "    if (response.status === 401) {\n      window.__homepanelStationheadRejectedAuthorization = headers.authorization;\n      window.__homepanelStationheadAuthHeaders = null;\n      post({ type: 'stationhead-auth-probe', state: 'auth-failed', status: response.status });\n      return;\n    }\n    if (response.status === 403) {\n      post({ type: 'stationhead-auth-probe', state: 'forbidden', status: response.status });\n      return;\n    }\n    if (!response.ok) throw new Error('http-' + response.status);",
    "do not treat auth probe 403 as logout",
)
shared_path.write_text(shared, encoding="utf-8")

app_path = Path("native/src/app.cpp")
app = app_path.read_text(encoding="utf-8")
app = replace_once(
    app,
    "    case UiAction::StationheadReconnect:\n      stationhead_->Reconnect();\n      break;",
    "    case UiAction::StationheadReconnect:\n      stationhead_->Reconnect();\n      if (secondaryStationhead_) secondaryStationhead_->Reconnect();\n      break;",
    "reconnect both Stationhead windows",
)
app_path.write_text(app, encoding="utf-8")

for path, needle in [
    (header_path, "authCaptureScriptRegistrationComplete_"),
    (cpp_path, "!authCaptureScriptRegistrationComplete_"),
    (webview_path, "status_.loginRequired = false"),
    (shared_path, "state: 'forbidden'"),
    (app_path, "secondaryStationhead_->Reconnect()"),
]:
    if needle not in path.read_text(encoding="utf-8"):
        raise SystemExit(f"missing expected fix in {path}: {needle}")
