from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new)


def regex_once(text, pattern, repl, label):
    out, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 regex match, got {count}')
    return out

# App: construct the only Stationhead player directly.
p = 'hp/native/src/app.cpp'
s = read(p)
s = replace_once(
    s,
    '  auto stationheadPlayer = std::make_unique<StationheadPlayer>(\n      StationheadRole::Primary, window_, config_.stationhead,\n      stationheadUserData, *logger_);',
    '  auto stationheadPlayer = std::make_unique<StationheadPlayer>(\n      window_, config_.stationhead, stationheadUserData, *logger_);',
    'app Stationhead constructor',
)
write(p, s)

# Shared message surface: no secondary handoff message.
p = 'hp/native/src/common.h'
s = read(p)
s = replace_once(s, 'constexpr UINT WM_HP_SECONDARY_RELOAD_READY = WM_APP + 9;\n', '', 'secondary reload message')
write(p, s)

# Stationhead declaration: remove role abstraction and secondary-only state.
p = 'hp/native/src/sh.h'
s = read(p)
s = regex_once(
    s,
    r'// Which Stationhead window this player instance backs\.[\s\S]*?enum class StationheadRole \{\n  Primary,\n  Secondary,\n\};\n\n',
    '',
    'StationheadRole enum',
)
s = s.replace(
    '  // App handles advance these when a primary/secondary notification or the\n  // local track-transition projection changes. Keeping them first lets the\n',
    '  // App handles advance this when the Stationhead notification or local\n  // track-transition projection changes. Keeping it first lets the\n',
)
for line in (
    '  uint64_t secondaryContentRevision = 0;\n',
    '  bool secondaryAudioMuted = false;\n',
    '  bool secondaryPlaying = false;\n',
    '  bool primaryAudioSelected = true;\n',
    '  std::wstring secondaryUrl;\n',
):
    if line not in s:
        raise RuntimeError(f'missing secondary status field: {line.strip()}')
    s = s.replace(line, '')
s = s.replace(
    "  // Recent per-day listening activity returned by the primary window's\n  // authenticated Stationhead account endpoint, oldest first; the last entry\n  // is today (partial, still accumulating). Empty for the secondary window.\n",
    '  // Recent per-day listening activity returned by the authenticated\n  // Stationhead account endpoint, oldest first; the last entry is today.\n',
)
s = replace_once(
    s,
    '// Drives one embedded Stationhead WebView2 window. Both Window A (Primary)\n// and Window B (Secondary) are the same class, distinguished only by `role_`.\n',
    '// Drives the single embedded Stationhead WebView2 window.\n',
    'player class comment',
)
s = replace_once(
    s,
    '  StationheadPlayer(StationheadRole role, HWND window, StationheadConfig config,\n                    fs::path userDataFolder, Logger& log);',
    '  StationheadPlayer(HWND window, StationheadConfig config,\n                    fs::path userDataFolder, Logger& log);',
    'constructor declaration',
)
s = regex_once(
    s,
    r'  \[\[nodiscard\]\] bool IsSecondary\(\) const noexcept \{ return role_ == StationheadRole::Secondary; \}\n  // Tags shared log lines[\s\S]*?  \[\[nodiscard\]\] const wchar_t\* RoleTag\(\) const noexcept \{ return IsSecondary\(\) \? L"B" : L"A"; \}\n',
    '  [[nodiscard]] static constexpr const wchar_t* RoleTag() noexcept { return L"A"; }\n',
    'role helpers',
)
s = s.replace('  void EnsureDistinctBrowserIdentity() noexcept;\n', '')
s = s.replace('  void PollAuthProbe(int64_t nowMs);\n', '')
s = s.replace('  StationheadRole role_;\n', '')
s = s.replace('  MonotonicElapsedTimestamp lastAuthProbeAt_;       // Secondary only.\n  MonotonicElapsedTimestamp authProbeStartedAt_;    // Secondary only.\n  bool authProbeInFlight_ = false;                  // Secondary only.\n', '')
s = s.replace('  ICoreWebView2* identityWebview_ = nullptr;  // Secondary only.\n', '')
write(p, s)

# Secondary browser identity no longer exists.
p = 'hp/native/src/sh_audio.cpp'
s = read(p)
s = regex_once(
    s,
    r'\nvoid StationheadPlayer::EnsureDistinctBrowserIdentity\(\) noexcept \{[\s\S]*?\n\}\n(?=\n\}  // namespace hp)',
    '',
    'secondary browser identity',
)
write(p, s)

# Main player implementation: retain only primary path.
p = 'hp/native/src/sh.cpp'
s = read(p)
s = s.replace("constexpr int64_t kAuthProbeIntervalMs = 5 * 60'000;\nconstexpr int64_t kAuthProbeTimeoutMs = 30'000;\n", '')
s = regex_once(
    s,
    r'\nstd::wstring StationheadAuthProbeScriptForRun\([\s\S]*?\n\}\n\}\n\nStationheadPlayer::StationheadPlayer',
    '\n}\n\nStationheadPlayer::StationheadPlayer',
    'auth probe helper',
)
s = replace_once(
    s,
    'StationheadPlayer::StationheadPlayer(StationheadRole role, HWND window, StationheadConfig config,\n                                     fs::path userDataFolder, Logger& log)\n    : role_(role), window_(window), config_(std::move(config)),\n      userDataFolder_(std::move(userDataFolder)),\n      profileName_(role == StationheadRole::Secondary ? L"stationhead-secondary" : L"Default"),\n      log_(log) {\n  if (IsSecondary()) status_.url = config_.secondaryUrl;\n}',
    'StationheadPlayer::StationheadPlayer(HWND window, StationheadConfig config,\n                                     fs::path userDataFolder, Logger& log)\n    : window_(window), config_(std::move(config)),\n      userDataFolder_(std::move(userDataFolder)), profileName_(L"Default"),\n      log_(log) {}',
    'constructor implementation',
)
s = replace_once(
    s,
    '  const UINT readyMessage = IsSecondary()\n      ? WM_HP_SECONDARY_RELOAD_READY\n      : WM_HP_PRIMARY_RELOAD_READY;\n  if (SendMessageW(window_, readyMessage, 0, 0) == 0) {',
    '  if (SendMessageW(window_, WM_HP_PRIMARY_RELOAD_READY, 0, 0) == 0) {',
    'reload handoff',
)
s = replace_once(s, '  return IsSecondary() ? config_.secondaryUrl : config_.url;\n', '  return config_.url;\n', 'current url')
s = s.replace('  lastAuthProbeAt_ = 0;\n  authProbeStartedAt_ = 0;\n  authProbeInFlight_ = false;\n', '')
s = regex_once(
    s,
    r'\nvoid StationheadPlayer::PollAuthProbe\(int64_t nowMs\) \{[\s\S]*?\n\}\n\nvoid StationheadPlayer::AttemptNativeStartClick',
    '\nvoid StationheadPlayer::AttemptNativeStartClick',
    'PollAuthProbe implementation',
)
s = regex_once(
    s,
    r'  if \(!IsSecondary\(\)\) \{\n    if \(nowMs - lastDailyPlayStatsAt_ >= kStationheadDailyPlayStatsIntervalMs\) PollDailyPlayStats\(nowMs\);\n    consider\(lastDailyPlayStatsAt_ \+ kStationheadDailyPlayStatsIntervalMs\);\n  \} else \{[\s\S]*?\n  \}\n  if \(!audioPlaying_',
    '  if (nowMs - lastDailyPlayStatsAt_ >= kStationheadDailyPlayStatsIntervalMs) PollDailyPlayStats(nowMs);\n  consider(lastDailyPlayStatsAt_ + kStationheadDailyPlayStatsIntervalMs);\n  if (!audioPlaying_',
    'Tick primary-only stats',
)
s = s.replace('Stationhead A authenticated stats script could not start ', 'Stationhead authenticated stats script could not start ')
write(p, s)

# WebView: one startup script, one message prefix, one auth/stats state machine.
p = 'hp/native/src/sh_webview.cpp'
s = read(p)
s = s.replace('  if (IsSecondary()) EnsureDistinctBrowserIdentity();\n', '')
s = replace_once(
    s,
    '  static const std::wstring primaryStartupScript =\n      StationheadAutoplayScript(L"__homepanelPrimaryStationhead", L"stationhead") +\n      L"\\n" + StationheadTrackBoundaryScript(L"stationhead");\n  static const std::wstring secondaryStartupScript =\n      StationheadAutoplayScript(L"__homepanelSecondaryStationhead", L"secondary") +\n      L"\\n" + StationheadTrackBoundaryScript(L"secondary");\n  const std::wstring& startupScript = IsSecondary() ? secondaryStartupScript : primaryStartupScript;\n',
    '  static const std::wstring startupScript =\n      StationheadAutoplayScript(L"__homepanelPrimaryStationhead", L"stationhead") +\n      L"\\n" + StationheadTrackBoundaryScript(L"stationhead");\n',
    'startup script selection',
)
s = regex_once(
    s,
    r'            if \(!IsSecondary\(\)\) \{\n              statsDocumentGeneration_ = 0;\n              statsAuthGeneration_ = 0;\n              statsLastAcceptedRequestId_ = 0;\n            \}\n            if \(IsSecondary\(\)\) \{[\s\S]*?\n            \}\n            UINT64 navigationId',
    '            statsDocumentGeneration_ = 0;\n            statsAuthGeneration_ = 0;\n            statsLastAcceptedRequestId_ = 0;\n            UINT64 navigationId',
    'navigation reset',
)
s = replace_once(s, '            const std::wstring prefix = IsSecondary() ? L"secondary" : L"stationhead";\n', '            const std::wstring prefix = L"stationhead";\n', 'message prefix')
s = s.replace('                if (IsSecondary()) return S_OK;\n', '')
s = replace_once(
    s,
    '                if (!IsSecondary() && rejectedAuthGeneration > 0 &&\n                    rejectedAuthGeneration == statsAuthGeneration_) {',
    '                if (rejectedAuthGeneration > 0 &&\n                    rejectedAuthGeneration == statsAuthGeneration_) {',
    'auth failure generation',
)
s = replace_once(
    s,
    '                if (!IsSecondary()) {\n                  const uint64_t authGeneration = positiveSafeInteger(\n                      json::Number(message, L"auth_generation", 0));\n                  if (authGeneration > 0) {\n                    statsAuthGeneration_ = authGeneration;\n                  }\n                }',
    '                const uint64_t authGeneration = positiveSafeInteger(\n                    json::Number(message, L"auth_generation", 0));\n                if (authGeneration > 0) {\n                  statsAuthGeneration_ = authGeneration;\n                }',
    'auth ready generation',
)
s = replace_once(
    s,
    '                if (IsSecondary()) {\n                  lastAuthProbeAt_ = 0;\n                  authProbeStartedAt_ = 0;\n                  authProbeInFlight_ = false;\n                } else {\n                  lastDailyPlayStatsAt_ = 0;\n                }',
    '                lastDailyPlayStatsAt_ = 0;',
    'auth ready schedule',
)
s = regex_once(
    s,
    r'              if \(type == L"stationhead-auth-probe"\) \{[\s\S]*?\n                return S_OK;\n              \}\n              if \(!spotifyAuthorization_',
    '              if (!spotifyAuthorization_',
    'auth probe handler',
)
s = replace_once(s, '    status_.detail = IsSecondary() ? L"creating isolated WebView2 environment" : L"起動中";\n', '    status_.detail = L"起動中";\n', 'status detail')
s = s.replace('  identityWebview_ = nullptr;\n', '')
s = s.replace('  lastAuthProbeAt_ = 0;\n  authProbeStartedAt_ = 0;\n  authProbeInFlight_ = false;\n', '')
write(p, s)

# Layout: one playback host and one auth host.
p = 'hp/native/src/sh_layout.cpp'
s = read(p)
s = regex_once(
    s,
    r'bool ConfiguresSecondaryStationheadWindow\(const StationheadConfig& config\) noexcept \{[\s\S]*?\n\}\n\nRECT ResolveStationheadWorkspaceBounds\(StationheadRole role,\n                                        const StationheadConfig& config,\n                                        HWND parent,\n                                        const RECT& requested\) noexcept \{\n  if \(role == StationheadRole::Secondary \|\| ConfiguresSecondaryStationheadWindow\(config\) \|\|\n      !parent \|\| !IsWindow\(parent\)\) return requested;',
    'RECT ResolveStationheadWorkspaceBounds(HWND parent,\n                                        const RECT& requested) noexcept {\n  if (!parent || !IsWindow(parent)) return requested;',
    'workspace resolver',
)
s = replace_once(
    s,
    '  hostWindow_ = IsSecondary()\n      ? CreateStationheadChildHost(window_, L"HomePanelSecondaryStationheadHost", L"SecondaryStationheadHost", bounds_)\n      : CreateStationheadChildHost(window_, L"HomePanelStationheadHost", L"StationheadHost", bounds_);',
    '  hostWindow_ = CreateStationheadChildHost(\n      window_, L"HomePanelStationheadHost", L"StationheadHost", bounds_);',
    'playback host',
)
s = replace_once(
    s,
    '  authHostWindow_ = IsSecondary()\n      ? CreateStationheadChildHost(window_, L"HomePanelSecondarySpotifyAuthHost", L"SecondarySpotifyAuthHost", bounds_)\n      : CreateStationheadChildHost(window_, L"HomePanelSpotifyAuthHost", L"SpotifyAuthHost", bounds_);',
    '  authHostWindow_ = CreateStationheadChildHost(\n      window_, L"HomePanelSpotifyAuthHost", L"SpotifyAuthHost", bounds_);',
    'auth host',
)
s = replace_once(s, '  const RECT resolved = ResolveStationheadWorkspaceBounds(role_, config_, window_, bounds);\n', '  const RECT resolved = ResolveStationheadWorkspaceBounds(window_, bounds);\n', 'SetBounds resolver')
write(p, s)

# Power-saving host routing: recognize only the single Stationhead host.
p = 'hp/native/src/power_saving_window_routing.inc'
s = read(p)
s = s.replace('constexpr wchar_t kSecondaryStationheadHostWindowClass[] =\n    L"HomePanelSecondaryStationheadHost";\n', '')
s = replace_once(
    s,
    '  return WindowHasClass(window, kStationheadHostWindowClass) ||\n      WindowHasClass(window, kSecondaryStationheadHostWindowClass);',
    '  return WindowHasClass(window, kStationheadHostWindowClass);',
    'power saving Stationhead host',
)
write(p, s)

# Dashboard playback routing: fallback follows the one Stationhead URL.
p = 'hp/native/src/dashboard_playback_resolve.cpp'
s = read(p)
s = replace_once(
    s,
    'bool SelectedStationheadIsOnFallback(const StationheadStatus& state) {\n  const bool secondarySelected =\n      !state.primaryAudioSelected && !state.secondaryUrl.empty();\n  const std::wstring& selectedUrl = secondarySelected\n      ? state.secondaryUrl\n      : state.url;\n  return IsPlaybackFallbackUrl(selectedUrl, state.fallbackUrl);\n}',
    'bool SelectedStationheadIsOnFallback(const StationheadStatus& state) {\n  return IsPlaybackFallbackUrl(state.url, state.fallbackUrl);\n}',
    'fallback selector',
)
s = s.replace('navigate both\n  // live Stationhead WebViews away', 'navigate the\n  // live Stationhead WebView away')
write(p, s)

# Shared helper: remove the secondary auth-probe implementation.
p = 'hp/native/src/sh_shared.h'
s = read(p)
s = s.replace(
    '// Shared "click Start Listening" automation injected into both Stationhead\n// WebViews at document creation. The two players differ only in the guard\n// global (so the script runs once per window kind) and the postMessage\n// prefix their native message handlers listen for.\n',
    '// Shared "click Start Listening" automation injected into the Stationhead\n// WebView at document creation.\n',
)
s = regex_once(s, r'\ninline std::wstring StationheadAuthProbeScript\(int channelId\) \{[\s\S]*?\n\}\n\n// Legacy DOM collector', '\n// Legacy DOM collector', 'shared auth probe')
write(p, s)

# Polling policy: remove the second-window probe and dual-window wording.
p = 'hp/native/src/sh_polling_policy.h'
s = read(p)
s = s.replace('#define StationheadAuthProbeScript StationheadAuthProbeScriptNetwork\n', '')
s = s.replace('#undef StationheadAuthProbeScript\n', '')
s = s.replace('in both long-lived WebViews.', 'in the long-lived WebView.')
s = s.replace('leaving both long-lived WebViews with', 'leaving the long-lived WebView with')
s = s.replace('for both Stationhead windows and never touches', 'for the Stationhead window and never touches')
s = regex_once(s, r'\n// Window B must not make an extra logged-in API request\.[\s\S]*?inline std::wstring StationheadAuthProbeScript\(int channelId\) \{[\s\S]*?\n\}\n', '\n', 'polling auth probe')
write(p, s)

# Final Stationhead policy: one 50-minute refresh and one monotonic clock.
p = 'hp/native/src/sh_track_boundary_message_policy.h'
s = read(p)
s = replace_once(
    s,
    "inline constexpr int64_t StationheadPeriodicRefreshIntervalMs(\n    bool secondary) noexcept {\n  return (secondary ? 54 : 53) * 60'000;\n}",
    "inline constexpr int64_t StationheadPeriodicRefreshIntervalMs() noexcept {\n  return 50 * 60'000;\n}",
    'periodic interval',
)
s = s.replace("static_assert(StationheadPeriodicRefreshIntervalMs(false) == 53 * 60'000);\nstatic_assert(StationheadPeriodicRefreshIntervalMs(true) == 54 * 60'000);\n", "static_assert(StationheadPeriodicRefreshIntervalMs() == 50 * 60'000);\n")
s = s.replace(
    '// source-rewriting macros before any implementation file is compiled. Periodic\n// refresh is intentionally independent per role: A uses 53 minutes and B uses\n// 54 minutes. The one-minute skew prevents the normal refreshes from starting\n// together without changing the active audio profile.\n',
    '// source-rewriting macros before any implementation file is compiled. The\n// single Stationhead player refreshes every 50 minutes.\n',
)
s = s.replace('::hp::StationheadPeriodicRefreshIntervalMs(IsSecondary())', '::hp::StationheadPeriodicRefreshIntervalMs()')
s = replace_once(
    s,
    '    NavigateCurrentUrl(                                                       \\\n        nowMs, IsSecondary() ? L"54-minute periodic refresh"                  \\\n                             : L"53-minute periodic refresh");                \\\n',
    '    NavigateCurrentUrl(nowMs, L"50-minute periodic refresh");                 \\\n',
    'periodic refresh reason',
)
s = s.replace('inline ULONGLONG secondaryReloadMonotonicAt = 0;\n', '')
s = s.replace('inline MonotonicProjectedDeadline secondaryAutoClickDeadline;\n', '')
s = s.replace('inline int64_t secondaryAutoClickExposed = 0;\n', '')
s = regex_once(
    s,
    r'inline int64_t& StationheadAutoClickDeadlineStorage\(\n    int64_t& storage, bool secondary\) noexcept \{[\s\S]*?\n\}\n\nclass StationheadNavigationInFlightProxy',
    '''inline int64_t& StationheadAutoClickDeadlineStorage(int64_t& storage) noexcept {
  auto& deadline = stationhead_boundary_message_policy::primaryAutoClickDeadline;
  int64_t& exposed = stationhead_boundary_message_policy::primaryAutoClickExposed;
  if (storage != exposed) deadline = storage;
  storage = StationheadProjectedDeadlineValue(deadline);
  exposed = storage;
  return storage;
}

class StationheadNavigationInFlightProxy''',
    'auto-click clock',
)
s = regex_once(
    s,
    r'class StationheadBoundaryReloadClockProxy \{[\s\S]*?inline StationheadBoundaryReloadClockProxy StationheadBoundaryReloadClock\(\n    int64_t& storage, bool secondary, bool configured\) noexcept \{\n  return StationheadBoundaryReloadClockProxy\(storage, secondary, configured\);\n\}',
    '''class StationheadBoundaryReloadClockProxy {
 public:
  StationheadBoundaryReloadClockProxy(int64_t& storage, bool configured) noexcept
      : storage_(storage), configured_(configured) {}

  operator int64_t() const noexcept { return storage_; }

  int64_t operator=(int64_t candidate) noexcept {
    AcquireSRWLockExclusive(&stationhead_boundary_message_policy::reloadClockLock);
    const bool accept = configured_ && storage_ <= 0;
    if (accept) {
      storage_ = candidate;
      stationhead_boundary_message_policy::primaryReloadMonotonicAt = GetTickCount64();
    }
    ReleaseSRWLockExclusive(&stationhead_boundary_message_policy::reloadClockLock);
    return candidate;
  }

  friend int64_t operator-(
      int64_t wallClockNow,
      const StationheadBoundaryReloadClockProxy& clock) noexcept {
    ULONGLONG monotonicAt = 0;
    AcquireSRWLockShared(&stationhead_boundary_message_policy::reloadClockLock);
    monotonicAt = stationhead_boundary_message_policy::primaryReloadMonotonicAt;
    ReleaseSRWLockShared(&stationhead_boundary_message_policy::reloadClockLock);
    if (monotonicAt == 0) return wallClockNow - clock.storage_;
    return StationheadBoundaryElapsedMs(monotonicAt, GetTickCount64());
  }

 private:
  int64_t& storage_;
  bool configured_;
};

inline StationheadBoundaryReloadClockProxy StationheadBoundaryReloadClock(
    int64_t& storage, bool configured) noexcept {
  return StationheadBoundaryReloadClockProxy(storage, configured);
}''',
    'reload clock',
)
s = s.replace('      (lastReloadAtStorage_), IsSecondary(), webViewConfigured_))', '      (lastReloadAtStorage_), webViewConfigured_))')
s = s.replace('      (nextAutoClickAt_), IsSecondary()))', '      (nextAutoClickAt_)))')
s = regex_once(
    s,
    r'\n// Window B no longer asks Stationhead\'s account API[\s\S]*?#define StationheadAuthProbeScript StationheadCurrentInteractionAuthProbeScript\n',
    '\n',
    'final auth probe bridge',
)
s = s.replace('same live DOM interaction state used by A and B.', 'same live DOM interaction state.')
write(p, s)

# Startup smoke: observe only the surviving Stationhead host.
p = 'hp/native/scripts/ci-native-stationhead-startup-smoke.ps1'
s = read(p)
marker = '$required = [ordered]@{'
pos = s.find(marker)
if pos < 0:
    raise RuntimeError('startup smoke required block not found')
head = s[:pos]
tail = r'''$required = [ordered]@{
  primaryWebViewConfigured = "Stationhead A registering required startup scripts"
  primaryStartupScriptRegistered = "Stationhead A startup script registration completed"
  primaryStationheadUrlNavigated = "Stationhead A navigation (startup): https://www.stationhead.com/sakuramankai"
  primaryStartListeningClickRequested = "Stationhead A auto-clicking Start Listening at"
}
$observed = [ordered]@{}
$observedAtMs = [ordered]@{}
foreach ($name in $required.Keys) {
  $observed[$name] = $false
  $observedAtMs[$name] = $null
}

function Save-DesktopScreenshot {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    if ($bounds.Width -le 0 -or $bounds.Height -le 0) { return }
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
      $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  } catch {
    "Screenshot unavailable: $($_.Exception.Message)" |
      Set-Content -LiteralPath (Join-Path $OutputDirectory "screenshot-error.txt") -Encoding utf8
  }
}

$process = $null
$startedAtUtc = [DateTime]::UtcNow
$mainWindow = [IntPtr]::Zero
$monitoringStartedAtUtc = $null
$firstSurfaceObservationAtUtc = $null
$postClickObserveUntilUtc = $null
$sampleCount = 0
$primaryHostSeen = $false
$primaryInteractiveAuthObserved = $false
$primaryInteractiveFront = $false
$primaryUnexpectedForegroundSamples = 0
$interactiveAuthSignalGraceSamples = 120
$violation = $null
$failureMessage = $null
$lastPrimaryState = "unobserved"
$lastPrimaryAuthHidden = $true

try {
  Write-Host "Starting observational native Stationhead startup smoke: $executablePath"
  $process = Start-Process -FilePath $executablePath -WorkingDirectory $workingDirectory -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

  while ([DateTime]::UtcNow -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) {
      throw "HomePanel exited before Stationhead startup smoke completed with code $($process.ExitCode)."
    }

    if ($mainWindow -eq [IntPtr]::Zero) {
      $mainWindow = [HomePanelStationheadObserveNative]::FindTopLevelWindow(
        $process.Id, "HomePanelNativeWindow")
    }

    $log = ""
    if (Test-Path -LiteralPath $logPath) {
      $log = [string](Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue)
      foreach ($name in $required.Keys) {
        if (-not $observed[$name] -and $log.Contains($required[$name])) {
          $elapsedMs = [int][Math]::Round(([DateTime]::UtcNow - $startedAtUtc).TotalMilliseconds)
          $observed[$name] = $true
          $observedAtMs[$name] = $elapsedMs
          Write-Host "Observed $name at ${elapsedMs}ms"
        }
      }
      if ($log.Contains("Stationhead A login required; window visible") -or
          $log.Contains("Stationhead A audio-loss state=auth_wait detail=authentication surface detected (")) {
        $primaryInteractiveAuthObserved = $true
      }
    }

    if ($mainWindow -ne [IntPtr]::Zero) {
      $sampleCount += 1
      $primaryHostSeen = $primaryHostSeen -or
        [HomePanelStationheadObserveNative]::HasDirectChild($mainWindow, "HomePanelStationheadHost")
      if ($primaryHostSeen -and -not $firstSurfaceObservationAtUtc) {
        $firstSurfaceObservationAtUtc = [DateTime]::UtcNow
      }

      $primaryBackgroundSafe = [HomePanelStationheadObserveNative]::PlaybackStartupSafe(
        $mainWindow, "HomePanelStationheadHost")
      $primaryInteractiveFront = $primaryInteractiveAuthObserved -and
        [HomePanelStationheadObserveNative]::InteractiveSurfaceAboveNativePanels(
          $mainWindow, "HomePanelStationheadHost")
      if ($primaryBackgroundSafe -or $primaryInteractiveFront) {
        $primaryUnexpectedForegroundSamples = 0
        $primaryStartupSafe = $true
      } else {
        $primaryUnexpectedForegroundSamples += 1
        $primaryStartupSafe = $primaryUnexpectedForegroundSamples -le $interactiveAuthSignalGraceSamples
      }

      $lastPrimaryAuthHidden = [HomePanelStationheadObserveNative]::DirectChildHiddenOrMissing(
        $mainWindow, "HomePanelSpotifyAuthHost")
      $lastPrimaryState = [HomePanelStationheadObserveNative]::SurfaceState(
        $mainWindow, "HomePanelStationheadHost")
      if (-not $primaryStartupSafe -or -not $lastPrimaryAuthHidden) {
        $violation = [ordered]@{
          phase = "startup"
          primaryPlayback = $lastPrimaryState
          primaryInteractiveAuth = $primaryInteractiveAuthObserved
          primaryInteractiveFront = $primaryInteractiveFront
          primaryAuthHidden = $lastPrimaryAuthHidden
          foregroundClass = [HomePanelStationheadObserveNative]::ForegroundClass()
        }
        throw "Stationhead startup invariant failed: [$lastPrimaryState] authHidden=$lastPrimaryAuthHidden"
      }

      $nativePanelsReady = [HomePanelStationheadObserveNative]::NativePanelCount($mainWindow) -ge 3
      $dashboardReady = $log.Contains("Native dashboard started")
      if (-not $monitoringStartedAtUtc -and $nativePanelsReady -and $dashboardReady) {
        $monitoringStartedAtUtc = [DateTime]::UtcNow
      }

      if ($monitoringStartedAtUtc) {
        $primaryOk =
          [HomePanelStationheadObserveNative]::PlaybackBehindNativePanels(
            $mainWindow, "HomePanelStationheadHost") -or
          $primaryInteractiveFront -or
          ($primaryUnexpectedForegroundSamples -gt 0 -and
           $primaryUnexpectedForegroundSamples -le $interactiveAuthSignalGraceSamples)
        if (-not $primaryOk -or -not $lastPrimaryAuthHidden) {
          throw "Stationhead foreground invariant failed: [$lastPrimaryState] authHidden=$lastPrimaryAuthHidden"
        }
      }
    }

    $missing = @($required.Keys | Where-Object { -not $observed[$_] })
    if ($missing.Count -eq 0 -and $monitoringStartedAtUtc -and $primaryHostSeen) {
      if ($null -eq $postClickObserveUntilUtc) {
        $startupElapsedMs = [int]$observedAtMs.primaryStartListeningClickRequested
        if ($startupElapsedMs -gt ($StartupBudgetSeconds * 1000)) {
          throw "Native Stationhead startup exceeded the ${StartupBudgetSeconds}s budget (${startupElapsedMs}ms)."
        }
        $postClickObserveUntilUtc = [DateTime]::UtcNow.AddSeconds($PostClickSettleSeconds)
      } elseif ([DateTime]::UtcNow -ge $postClickObserveUntilUtc) {
        break
      }
    }

    Start-Sleep -Milliseconds 25
  }

  $missing = @($required.Keys | Where-Object { -not $observed[$_] })
  if ($missing.Count -ne 0) {
    throw "Native Stationhead startup did not reach: $($missing -join ', ')."
  }
  if (-not $monitoringStartedAtUtc -or -not $primaryHostSeen -or -not $firstSurfaceObservationAtUtc) {
    throw "Stationhead primary host/dashboard observation did not become ready."
  }
  if ($null -eq $postClickObserveUntilUtc -or [DateTime]::UtcNow -lt $postClickObserveUntilUtc) {
    throw "The post-click foreground observation window did not complete."
  }
} catch {
  $failureMessage = $_.Exception.Message
} finally {
  if ($process) {
    $process.Refresh()
    if (-not $process.HasExited) {
      Save-DesktopScreenshot
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(5000) | Out-Null
    }
  }
  if (Test-Path -LiteralPath $logPath) {
    Copy-Item -LiteralPath $logPath -Destination $copiedLogPath -Force -ErrorAction SilentlyContinue
  }

  [ordered]@{
    executable = $executablePath
    startedAtUtc = $startedAtUtc.ToString("o")
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
    primaryHostSeen = $primaryHostSeen
    primaryInteractiveAuthObserved = $primaryInteractiveAuthObserved
    finalPrimaryInteractiveFront = $primaryInteractiveFront
    primaryUnexpectedForegroundSamples = $primaryUnexpectedForegroundSamples
    observationalOnly = $true
    sampleCount = $sampleCount
    postClickObservationSeconds = $PostClickSettleSeconds
    observed = $observed
    observedAtMs = $observedAtMs
    finalPrimaryPlayback = $lastPrimaryState
    finalPrimaryAuthHidden = $lastPrimaryAuthHidden
    violation = $violation
    failure = $failureMessage
    passed = [string]::IsNullOrEmpty($failureMessage)
  } | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $resultPath -Encoding utf8
}

if (-not [string]::IsNullOrEmpty($failureMessage)) {
  throw $failureMessage
}
'''
write(p, head + tail)

# Ensure no production secondary Stationhead implementation remains.
checks = [
    ('hp/native/src', r'StationheadRole::Secondary|IsSecondary\(|secondaryEnabled|secondaryUrl|HomePanelSecondaryStationhead|HomePanelSecondarySpotifyAuthHost|WM_HP_SECONDARY_RELOAD_READY|stationhead-secondary|PollAuthProbe|authProbeInFlight_|authProbeStartedAt_|lastAuthProbeAt_|secondaryAutoClick|secondaryReloadMonotonicAt|StationheadAuthProbeScript'),
]
for root, pattern in checks:
    rx = re.compile(pattern)
    leftovers = []
    for path in Path(root).rglob('*'):
        if path.is_file() and path.suffix.lower() in {'.h', '.cpp', '.inc'}:
            text = path.read_text(encoding='utf-8')
            for i, line in enumerate(text.splitlines(), 1):
                if rx.search(line):
                    leftovers.append(f'{path}:{i}:{line.strip()}')
    if leftovers:
        raise RuntimeError('secondary Stationhead production references remain:\n' + '\n'.join(leftovers[:40]))

print('Stationhead primary-only source refactor applied')
