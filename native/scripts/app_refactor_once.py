from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8", newline="\n")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


def regex_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return updated


# Build each implementation file as a normal translation unit.
cmake = read("native/CMakeLists.txt")
cmake = replace_once(
    cmake,
    "set(HOMEPANEL_CORE_SOURCES\n  src/main.cpp\n  src/app.cpp\n",
    "set(HOMEPANEL_CORE_SOURCES\n  src/main.cpp\n  src/app.cpp\n"
    "  src/app_air_history.cpp\n"
    "  src/app_stationhead_history.cpp\n"
    "  src/app_stationhead_state.cpp\n"
    "  src/app_update.cpp\n"
    "  src/app_messages.cpp\n"
    "  src/app_commands.cpp\n",
    "CMake app source list",
)
write("native/CMakeLists.txt", cmake)

# Make shared app-only constants and state adaptation explicit class responsibilities.
app_h = read("native/src/app.h")
app_h = replace_once(
    app_h,
    " private:\n  static LRESULT CALLBACK WindowProc",
    " private:\n"
    "  static constexpr UINT kUpdateResultMessage = WM_APP + 20;\n"
    "  static constexpr int kRestartExitCode = 42;\n"
    "  static void EnrichRenderStationheadState(\n"
    "      StationheadStatus& state, StationheadStatus* secondaryStatus,\n"
    "      const StationheadConfig& config);\n"
    "  static LRESULT CALLBACK WindowProc",
    "App private constants",
)
app_h = replace_once(app_h, "  bool running_ = false;\n", "", "remove running state")
app_h = replace_once(app_h, "  uint64_t lastRadarFrameStamp_ = 0;\n", "", "remove radar stamp")
app_h = replace_once(
    app_h,
    "  int exitCode_ = 0;\n",
    "  int exitCode_ = 0;\n  int startupShowCommand_ = SW_SHOW;\n",
    "startup show command member",
)
write("native/src/app.h", app_h)

stationhead_state = '''#include "app.h"

namespace hp {

void App::EnrichRenderStationheadState(
    StationheadStatus& state,
    StationheadStatus* secondaryStatus,
    const StationheadConfig& config) {
  state.fallbackUrl = config.fallbackUrl;
  if (secondaryStatus) {
    state.loginRequired = state.loginRequired || secondaryStatus->loginRequired;
    state.secondaryAudioMuted = secondaryStatus->audioMuted;
    state.secondaryPlaying = secondaryStatus->playing;
    state.secondaryUrl = std::move(secondaryStatus->url);
    return;
  }
  state.secondaryAudioMuted = false;
  state.secondaryPlaying = false;
  state.secondaryUrl.clear();
}

}  // namespace hp
'''
write("native/src/app_stationhead_state.cpp", stationhead_state)

app_cpp = read("native/src/app.cpp")
app_cpp = replace_once(app_cpp, '#pragma comment(lib, "version.lib")\n\n', "", "move version pragma")
app_cpp = replace_once(app_cpp, '#include <winrt/Windows.Data.Json.h>\n', "", "remove JSON include")
app_cpp = replace_once(app_cpp, "constexpr UINT WM_HP_UPDATE_RESULT = WM_APP + 20;\n", "", "remove update message global")
app_cpp = replace_once(app_cpp, "constexpr int kRestartExitCode = 42;\n", "", "remove restart code global")
app_cpp = replace_once(app_cpp, "int startupShowCommand = SW_SHOW;\n", "", "remove startup global")
app_cpp = regex_once(
    app_cpp,
    r"std::wstring InstalledHomePanelVersion\(const fs::path& executable\) \{.*?\n\}\n\n\n(?=uint32_t NextDelayFromDeadline)",
    "",
    "move installed version helper",
)
app_cpp = regex_once(
    app_cpp,
    r"void EnrichRenderStationheadState\(\n    StationheadStatus& state,\n    StationheadStatus\* secondaryStatus,\n    const StationheadConfig& config\) \{.*?\n\}\n\n",
    "",
    "move stationhead render adapter",
)
app_cpp = replace_once(app_cpp, "  running_ = true;\n", "", "remove running true")
app_cpp = replace_once(app_cpp, "  running_ = false;\n", "", "remove running false")
app_cpp = replace_once(
    app_cpp,
    "  startupShowCommand = showCommand == SW_HIDE ? SW_SHOW : showCommand;\n",
    "  startupShowCommand_ = showCommand == SW_HIDE ? SW_SHOW : showCommand;\n",
    "store startup command on App",
)
app_cpp = replace_once(
    app_cpp,
    "  ShowWindow(window_, startupShowCommand);\n",
    "  ShowWindow(window_, startupShowCommand_);\n",
    "use startup command member",
)
app_cpp = replace_once(
    app_cpp,
    "      !rendererStarted_ || renderState_.maintenance ||\n",
    "      !rendererStarted_ ||\n",
    "remove maintenance tick state",
)
app_cpp = replace_once(
    app_cpp,
    "    renderer_->Render(paint.rcPaint, renderState_);\n",
    "    renderer_->Render();\n",
    "simplify renderer paint",
)
app_cpp = replace_once(
    app_cpp,
    "  renderState_.workspaceTab = static_cast<int>(selectedTab_);\n",
    "",
    "remove renderer workspace state",
)
app_cpp = regex_once(
    app_cpp,
    r"void App::HandleAction\(UiAction action\) \{.*?\n\}\n\nvoid App::LogUnhandled",
    '''void App::HandleAction(UiAction action) {
  switch (action) {
    case UiAction::AppUpdate:
      CheckForUpdateAsync(true);
      break;
    case UiAction::Restart:
      exitCode_ = kRestartExitCode;
      DestroyWindow(window_);
      break;
    case UiAction::StationheadAudioToggle:
      ToggleStationheadAudio();
      break;
    case UiAction::StationheadAudioMute:
      MuteStationheadAudio();
      break;
    case UiAction::None:
    default:
      break;
  }
}

void App::LogUnhandled''',
    "simplify action dispatch",
)
app_cpp = regex_once(
    app_cpp,
    r"\n\n\n#include \"app_air_history\.cpp\"\n#include \"app_stationhead_history\.cpp\"\n#include \"app_update\.cpp\"\n#include \"app_messages\.cpp\"\n#include \"app_commands\.cpp\"\n?",
    "\n",
    "remove implementation includes",
)
write("native/src/app.cpp", app_cpp)

app_messages = read("native/src/app_messages.cpp")
app_messages = regex_once(
    app_messages,
    r"    case WM_LBUTTONUP: \{\n      if \(!renderer_\) return 0;\n      POINT point\{GET_X_LPARAM\(lParam\), GET_Y_LPARAM\(lParam\)\};\n      HandleAction\(renderer_->HitTest\(point\)\);\n      return 0;\n    \}\n",
    "    case WM_LBUTTONUP:\n      if (renderer_) HandleAction(renderer_->TakePendingAction());\n      return 0;\n",
    "simplify action message",
)
app_messages = regex_once(
    app_messages,
    r"    case WM_KEYDOWN:\n.*?      return 0;\n",
    "",
    "remove dead maintenance shortcuts",
)
app_messages = replace_once(
    app_messages,
    "    case WM_HP_UPDATE_RESULT: {\n",
    "    case kUpdateResultMessage: {\n",
    "use app update message constant",
)
write("native/src/app_messages.cpp", app_messages)

app_update = read("native/src/app_update.cpp")
app_update = replace_once(
    app_update,
    '#include "app.h"\n',
    '#pragma comment(lib, "version.lib")\n\n#include "app.h"\n#include "version.h"\n',
    "move version dependency",
)
app_update = replace_once(
    app_update,
    "namespace hp {\n\n",
    '''namespace hp {
namespace {

std::wstring InstalledHomePanelVersion(const fs::path& executable) {
  DWORD handle = 0;
  const DWORD size = GetFileVersionInfoSizeW(executable.c_str(), &handle);
  if (!size) return {};
  std::vector<BYTE> data(size);
  if (!GetFileVersionInfoW(executable.c_str(), 0, size, data.data())) return {};
  VS_FIXEDFILEINFO* info = nullptr;
  UINT infoSize = 0;
  if (!VerQueryValueW(data.data(), L"\\\\", reinterpret_cast<void**>(&info), &infoSize) ||
      !info || infoSize < sizeof(VS_FIXEDFILEINFO) || info->dwSignature != 0xfeef04bd) {
    return {};
  }
  std::wostringstream version;
  version << HIWORD(info->dwFileVersionMS) << L'.'
          << LOWORD(info->dwFileVersionMS) << L'.'
          << HIWORD(info->dwFileVersionLS);
  const WORD revision = LOWORD(info->dwFileVersionLS);
  if (revision) version << L'.' << revision;
  return version.str();
}

}  // namespace

''',
    "add installed version helper",
)
app_update = replace_once(
    app_update,
    '''      renderState_.toast = L"更新確認はすでに実行中です";
      ShowToast(std::move(renderState_.toast), 4000);
''',
    '      ShowToast(L"更新確認はすでに実行中です", 4000);\n',
    "simplify busy update toast",
)
app_update = replace_once(
    app_update,
    '''    renderState_.toast = L"署名・ハッシュを確認して更新を準備しています";
    ShowToast(std::move(renderState_.toast), 15'000);
''',
    '    ShowToast(L"署名・ハッシュを確認して更新を準備しています", 15\'000);\n',
    "simplify update toast",
)
app_update = replace_once(
    app_update,
    "PostMessageW(window_, WM_HP_UPDATE_RESULT, 0, reinterpret_cast<LPARAM>(copy.get()))",
    "PostMessageW(window_, kUpdateResultMessage, 0, reinterpret_cast<LPARAM>(copy.get()))",
    "use update result constant",
)
write("native/src/app_update.cpp", app_update)

renderer_h = read("native/src/web_renderer.h")
renderer_h = regex_once(
    renderer_h,
    r"enum class UiAction \{.*?\n\};",
    '''enum class UiAction {
  None,
  AppUpdate,
  Restart,
  StationheadAudioToggle,
  StationheadAudioMute,
};''',
    "trim UI actions",
)
renderer_h = replace_once(renderer_h, "  int workspaceTab = 0;\n", "", "remove workspace render field")
renderer_h = replace_once(renderer_h, "  bool maintenance = false;\n", "", "remove maintenance render field")
renderer_h = replace_once(
    renderer_h,
    "  void Render(const RECT& dirty, const RenderState& state);\n",
    "  void Render();\n",
    "simplify Render declaration",
)
renderer_h = replace_once(
    renderer_h,
    "  UiAction HitTest(POINT point);\n",
    "  UiAction TakePendingAction();\n",
    "rename pending action API",
)
renderer_h = replace_once(renderer_h, "  RECT ClientBounds() const;\n", "", "remove client bounds API")
write("native/src/web_renderer.h", renderer_h)

lifecycle = read("native/src/renderer_lifecycle.cpp")
lifecycle = replace_once(lifecycle, "RECT Renderer::ClientBounds() const { return bounds_; }\n\n", "", "remove client bounds definition")
lifecycle = replace_once(
    lifecycle,
    "UiAction Renderer::HitTest(POINT) {\n",
    "UiAction Renderer::TakePendingAction() {\n",
    "rename action take method",
)
lifecycle = regex_once(
    lifecycle,
    r"void Renderer::Render\(const RECT& dirty, const RenderState& state\) \{\n  \(void\)dirty;\n  \(void\)state;\n",
    "void Renderer::Render() {\n",
    "simplify Render definition",
)
write("native/src/renderer_lifecycle.cpp", lifecycle)

# Keep the permanent CI guard, while removing this one-shot bootstrap from the workflow.
workflow_path = ".github/workflows/native-windows-build.yml"
workflow = read(workflow_path)
workflow = replace_once(workflow, "permissions:\n  contents: write\n\n", "", "remove bootstrap permissions")
workflow = replace_once(
    workflow,
    '''        with:
          show-progress: false
          ref: ${{ github.head_ref || github.ref_name }}
          fetch-depth: 0

      - name: Apply native app refactor
        if: github.event_name == 'pull_request' && github.head_ref == 'agent/cache-native-panels'
        shell: pwsh
        run: |
          python native/scripts/app_refactor_once.py
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          if (-not (git diff --cached --quiet)) {
            git commit -m "refactor(native): split app responsibilities"
            git push origin "HEAD:$env:GITHUB_HEAD_REF"
          }

''',
    '''        with:
          show-progress: false

''',
    "remove bootstrap step",
)
workflow = replace_once(
    workflow,
    "      - name: Verify static Stationhead source build\n",
    "      - name: Verify static native source build\n",
    "rename source verification",
)
workflow = replace_once(
    workflow,
    '''          foreach ($path in @(
            "native/scripts/generate_stationhead_sources.ps1",
            "native/scripts/ui/index.html",
            "native/scripts/ui/styles.css",
            "native/scripts/ui/app.js"
          )) {
            if (Test-Path -LiteralPath $path) {
              throw "Removed Stationhead/browser dashboard source '$path' still exists."
            }
          }
''',
    '''          foreach ($path in @(
            "native/scripts/generate_stationhead_sources.ps1",
            "native/scripts/ui/index.html",
            "native/scripts/ui/styles.css",
            "native/scripts/ui/app.js"
          )) {
            if (Test-Path -LiteralPath $path) {
              throw "Removed Stationhead/browser dashboard source '$path' still exists."
            }
          }
          $appSource = Get-Content -LiteralPath "native/src/app.cpp" -Raw
          foreach ($token in @(
            '#include "app_air_history.cpp"',
            '#include "app_stationhead_history.cpp"',
            '#include "app_update.cpp"',
            '#include "app_messages.cpp"',
            '#include "app_commands.cpp"'
          )) {
            if ($appSource.Contains($token)) {
              throw "App implementation include '$token' must be compiled as its own translation unit."
            }
          }
''',
    "add app translation-unit guard",
)
write(workflow_path, workflow)

Path(__file__).unlink()
