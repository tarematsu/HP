from pathlib import Path
import re


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


p = Path('hp/native/src/sh_layout.cpp')
s = p.read_text(encoding='utf-8')
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
s = replace_once(
    s,
    '  const RECT resolved = ResolveStationheadWorkspaceBounds(role_, config_, window_, bounds);\n',
    '  const RECT resolved = ResolveStationheadWorkspaceBounds(window_, bounds);\n',
    'SetBounds resolver',
)
p.write_text(s, encoding='utf-8')

p = Path('hp/native/src/sh_track_boundary_message_policy.h')
s = p.read_text(encoding='utf-8')
s = replace_once(
    s,
    "inline constexpr int64_t StationheadPeriodicRefreshIntervalMs(\n    bool secondary) noexcept {\n  (void)secondary;\n  return 50 * 60'000;\n}",
    "inline constexpr int64_t StationheadPeriodicRefreshIntervalMs() noexcept {\n  return 50 * 60'000;\n}",
    'refresh interval',
)
s = s.replace(
    "static_assert(StationheadPeriodicRefreshIntervalMs(false) == 50 * 60'000);\nstatic_assert(StationheadPeriodicRefreshIntervalMs(true) == 50 * 60'000);\n",
    "static_assert(StationheadPeriodicRefreshIntervalMs() == 50 * 60'000);\n",
)
s = s.replace(
    '// source-rewriting macros before any implementation file is compiled. Every\n// Stationhead role uses the same 50-minute periodic refresh interval.\n',
    '// source-rewriting macros before any implementation file is compiled. The\n// single Stationhead player refreshes every 50 minutes.\n',
)
s = s.replace(
    '::hp::StationheadPeriodicRefreshIntervalMs(IsSecondary())',
    '::hp::StationheadPeriodicRefreshIntervalMs()',
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
s = s.replace(
    '      (lastReloadAtStorage_), IsSecondary(), webViewConfigured_))',
    '      (lastReloadAtStorage_), webViewConfigured_))',
)
s = s.replace(
    '      (nextAutoClickAt_), IsSecondary()))',
    '      (nextAutoClickAt_)))',
)
s, removed = re.subn(
    r'\n// Window B no longer asks Stationhead\'s account API[\s\S]*?#define StationheadAuthProbeScript StationheadCurrentInteractionAuthProbeScript\n',
    '\n',
    s,
    count=1,
)
if removed != 1:
    raise RuntimeError(f'final auth probe block: expected 1 match, got {removed}')
s = s.replace(
    '// The page-side detector is the single source of in-page interaction state for\n// both A and B. It already raises the existing login-required message when a\n',
    '// The page-side detector is the single source of in-page interaction state.\n// It already raises the existing login-required message when a\n',
)
p.write_text(s, encoding='utf-8')
