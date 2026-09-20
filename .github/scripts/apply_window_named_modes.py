from pathlib import Path


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, got {count}')
    return text.replace(old, new, 1)


def replace_test(path, title, replacement):
    s = read(path)
    needle = f"test('{title}', () => {{"
    start = s.index(needle)
    next_test = s.find("\n\ntest('", start + len(needle))
    end = len(s) if next_test < 0 else next_test
    write(path, s[:start] + replacement.rstrip() + s[end:])


# Keep the existing MonitorMode enum, but ServiceGrid now selects one profile.
p = 'hp/native/src/power_saving_controller.h'
s = read(p)
s = replace_once(
    s,
    '  MonitorMode monitorMode_ = MonitorMode::Native;\n  bool monitorAuthForeground_ = false;',
    '  MonitorMode monitorMode_ = MonitorMode::Native;\n  unsigned monitorStationheadProfile_ = 6;\n  bool monitorAuthForeground_ = false;',
    'controller monitor profile state',
)
write(p, s)

# Share exactly which Stationhead profile is in monitor foreground.
p = 'hp/native/src/stationhead_monitor_probe.h'
s = read(p)
start = s.index('// Monitor placement and Stationhead WebView layout live in separate modules.')
end = s.index('\n}  // namespace hp', start)
block = '''// Monitor placement and Stationhead WebView layout live in separate modules.
// A value of 1..6 identifies the single Stationhead window selected for the
// monitor surface. Zero means no Stationhead monitor is selected.
inline std::atomic<unsigned> gStationheadMonitorProfile{0};

inline bool SetStationheadMonitorProfile(unsigned profile) noexcept {
  if (profile > 6) profile = 0;
  return gStationheadMonitorProfile.exchange(
             profile, std::memory_order_acq_rel) != profile;
}

inline unsigned StationheadMonitorProfile() noexcept {
  return gStationheadMonitorProfile.load(std::memory_order_acquire);
}

inline unsigned StationheadProfileNumber(
    const std::wstring& profileName) noexcept {
  if (profileName == L"spotify-v2-1") return 1;
  if (profileName == L"spotify-v2-2") return 2;
  if (profileName == L"spotify-v2-3") return 3;
  if (profileName == L"spotify-v2-4") return 4;
  if (profileName == L"spotify-v2-5") return 5;
  if (profileName == L"spotify-v2-6") return 6;
  return 0;
}

inline bool StationheadMonitorForegroundForProfile(
    const std::wstring& profileName) noexcept {
  const unsigned selected = StationheadMonitorProfile();
  return selected != 0 && selected == StationheadProfileNumber(profileName);
}

inline bool SetStationheadMonitorForeground(bool foreground) noexcept {
  return SetStationheadMonitorProfile(foreground ? 6u : 0u);
}

inline bool StationheadMonitorForeground() noexcept {
  return StationheadMonitorProfile() != 0;
}
'''
s = s[:start] + block + s[end:]
write(p, s)

# Monitor cycle: YT -> ozeki -> tgut -> yuukiar -> ten -> nagi -> hinata -> OFF -> YT.
p = 'hp/native/src/power_saving_schedule.inc'
s = read(p)
start = s.index('void PowerSavingController::CycleMonitorMode() noexcept {')
end = s.index('\nvoid PowerSavingController::ApplyMonitorMode', start)
cycle = '''void PowerSavingController::CycleMonitorMode() noexcept {
  switch (monitorMode_) {
    case MonitorMode::Native:
      monitorStationheadProfile_ = 6;
      ApplyMonitorMode(MonitorMode::ServiceGrid);
      break;
    case MonitorMode::ServiceGrid:
      if (monitorStationheadProfile_ == 5) {
        ApplyMonitorMode(MonitorMode::Off);
      } else {
        monitorStationheadProfile_ = monitorStationheadProfile_ == 6
            ? 1
            : std::clamp(monitorStationheadProfile_ + 1, 1u, 5u);
        ApplyMonitorMode(MonitorMode::ServiceGrid);
      }
      break;
    case MonitorMode::Off:
      ApplyMonitorMode(MonitorMode::Native);
      break;
  }
}
'''
s = s[:start] + cycle + s[end:]
s = replace_once(
    s,
    '  monitorMode_ = mode;\n  powerSaving_ = nextPowerSaving;',
    '  monitorMode_ = mode;\n  const unsigned selectedMonitorProfile =\n      mode == MonitorMode::ServiceGrid ? monitorStationheadProfile_ : 0;\n  SetStationheadMonitorProfile(selectedMonitorProfile);\n  powerSaving_ = nextPowerSaving;',
    'apply monitor profile',
)
s = s.replace(
    '  // Monitor S is a dedicated six-Stationhead surface. Hide the normal dashboard\n  // and YouTube/TVer panel without stopping their playback lifecycle.',
    '  // A named Stationhead monitor is a dedicated single-window surface. Hide the\n  // normal dashboard without stopping any Stationhead playback lifecycle.',
)
write(p, s)

# Use logical window names in the overlay.
p = 'hp/native/src/power_saving_overlay.inc'
s = read(p)
old_monitor = '''  const wchar_t* monitorLabel = L"モニターYT";
  if (monitorMode_ == MonitorMode::ServiceGrid) {
    monitorLabel = L"モニターS";
  } else if (monitorMode_ == MonitorMode::Off) {
    monitorLabel = L"モニターOFF";
  }'''
new_monitor = '''  const wchar_t* monitorLabel = L"モニターYT";
  if (monitorMode_ == MonitorMode::ServiceGrid) {
    switch (monitorStationheadProfile_) {
      case 1: monitorLabel = L"モニターtgut"; break;
      case 2: monitorLabel = L"モニターyuukiar"; break;
      case 3: monitorLabel = L"モニターten"; break;
      case 4: monitorLabel = L"モニターnagi"; break;
      case 5: monitorLabel = L"モニターhinata"; break;
      case 6: monitorLabel = L"モニターozeki"; break;
      default: monitorLabel = L"モニターOFF"; break;
    }
  } else if (monitorMode_ == MonitorMode::Off) {
    monitorLabel = L"モニターOFF";
  }'''
s = replace_once(s, old_monitor, new_monitor, 'monitor labels')
old_audio = '''  const wchar_t* audioModeLabel = L"音声出力YT";
  if (audioMode_ == AudioMode::Stationhead) {
    audioModeLabel = L"音声出力ST";
  } else if (audioMode_ == AudioMode::StationheadPeer1) {
    audioModeLabel = L"音声出力S1";
  } else if (audioMode_ == AudioMode::StationheadPeer2) {
    audioModeLabel = L"音声出力S2";
  } else if (audioMode_ == AudioMode::StationheadPeer3) {
    audioModeLabel = L"音声出力S3";
  } else if (audioMode_ == AudioMode::StationheadPeer4) {
    audioModeLabel = L"音声出力S4";
  } else if (audioMode_ == AudioMode::StationheadPeer5) {
    audioModeLabel = L"音声出力S5";
  } else if (audioMode_ == AudioMode::Muted) {
    audioModeLabel = L"音声出力OFF";
  }'''
new_audio = '''  const wchar_t* audioModeLabel = L"音声出力YT";
  if (audioMode_ == AudioMode::Stationhead) {
    audioModeLabel = L"音声出力ozeki";
  } else if (audioMode_ == AudioMode::StationheadPeer1) {
    audioModeLabel = L"音声出力tgut";
  } else if (audioMode_ == AudioMode::StationheadPeer2) {
    audioModeLabel = L"音声出力yuukiar";
  } else if (audioMode_ == AudioMode::StationheadPeer3) {
    audioModeLabel = L"音声出力ten";
  } else if (audioMode_ == AudioMode::StationheadPeer4) {
    audioModeLabel = L"音声出力nagi";
  } else if (audioMode_ == AudioMode::StationheadPeer5) {
    audioModeLabel = L"音声出力hinata";
  } else if (audioMode_ == AudioMode::Muted) {
    audioModeLabel = L"音声出力OFF";
  }'''
s = replace_once(s, old_audio, new_audio, 'audio labels')
write(p, s)

# Promote only the selected Stationhead host to the monitor surface.
p = 'hp/native/src/power_saving_window_routing.inc'
s = read(p)
marker = 'size_t StationheadServiceTileIndex(HWND window) noexcept {'
idx = s.index(marker)
helper = '''unsigned StationheadProfileNumberFromWindow(HWND window) noexcept {
  wchar_t title[128]{};
  if (!window || GetWindowTextW(window, title, _countof(title)) <= 0) return 0;
  const wchar_t* profile = wcsstr(title, L"spotify-v2-");
  if (!profile) return 0;
  profile += wcslen(L"spotify-v2-");
  wchar_t* end = nullptr;
  const long number = wcstol(profile, &end, 10);
  return end != profile && number >= 1 && number <= 6
      ? static_cast<unsigned>(number)
      : 0;
}

'''
s = s[:idx] + helper + s[idx:]
start = s.index('void PowerSavingController::ApplyStationheadMonitorPlacement() noexcept {')
end = s.index('\nvoid PowerSavingController::Detach() noexcept {', start)
placement = '''void PowerSavingController::ApplyStationheadMonitorPlacement() noexcept {
  if (!parent_ || !IsWindow(parent_)) return;

  const unsigned selectedProfile =
      monitorMode_ == MonitorMode::ServiceGrid ? monitorStationheadProfile_ : 0;
  const bool nativeMediaForeground =
      monitorMode_ == MonitorMode::Native && !monitorAuthForeground_;

  if (SetStationheadMonitorProfile(selectedProfile)) {
    PostMessageW(parent_, WM_TIMER, 0, 0);
  }

  RECT parentClient{0, 0, 1, 1};
  GetClientRect(parent_, &parentClient);

  struct Context {
    PowerSavingController* controller;
    unsigned selectedProfile;
    bool nativeMediaForeground;
    RECT parentClient;
  } context{this, selectedProfile, nativeMediaForeground, parentClient};

  EnumChildWindows(
      parent_,
      [](HWND child, LPARAM value) -> BOOL {
        auto* context = reinterpret_cast<Context*>(value);
        PowerSavingController* controller = context->controller;

        if (IsMvPanelWindow(child)) {
          const RECT target = context->nativeMediaForeground
              ? NativeMvForegroundBounds(child)
              : RECT{0, 0, 1, 1};
          if (!ChildBoundsMatch(child, target) || !IsWindowVisible(child)) {
            SetWindowPos(
                child, nullptr,
                target.left, target.top,
                std::max<LONG>(1, target.right - target.left),
                std::max<LONG>(1, target.bottom - target.top),
                SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING |
                    SWP_NOZORDER);
          }
          return TRUE;
        }

        if (!IsStationheadPlaybackHost(child) || context->selectedProfile == 0 ||
            StationheadProfileNumberFromWindow(child) != context->selectedProfile) {
          return TRUE;
        }

        const RECT target = context->parentClient;
        const HWND insertAfter = controller->overlay_ ? controller->overlay_ : HWND_TOP;
        const bool zOrderMatches = controller->overlay_
            ? GetWindow(child, GW_HWNDPREV) == controller->overlay_
            : GetWindow(child, GW_HWNDPREV) == nullptr;
        if (!ChildBoundsMatch(child, target) || !IsWindowVisible(child) || !zOrderMatches) {
          SetWindowPos(
              child, insertAfter,
              target.left, target.top,
              std::max<LONG>(1, target.right - target.left),
              std::max<LONG>(1, target.bottom - target.top),
              SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&context));
}
'''
s = s[:start] + placement + s[end:]
s = s.replace('  SetStationheadMonitorForeground(false);', '  SetStationheadMonitorProfile(0);')
write(p, s)

# Make each Stationhead player react only when its own profile is selected.
p = 'hp/native/src/sh_layout.cpp'
s = read(p)
s = replace_once(
    s,
    '                                 bool showPlayback,\n                                 bool hidePlayback) {\n  const bool monitorForeground = StationheadMonitorForeground();',
    '                                 bool showPlayback,\n                                 bool hidePlayback,\n                                 bool monitorForeground) {',
    'layout monitor argument',
)
s = s.replace(
    '                              false, false, false);',
    '                              false, false, false,\n                              StationheadMonitorForegroundForProfile(profileName_));',
)
s = replace_once(
    s,
    '                              showAuth,\n                              showPlayback,\n                              hidePlayback);',
    '                              showAuth,\n                              showPlayback,\n                              hidePlayback,\n                              monitorForeground);',
    'layout selected profile call',
)
s = s.replace('StationheadMonitorForeground()', 'StationheadMonitorForegroundForProfile(profileName_)')
write(p, s)

# Update static tests that pinned the old six-tile Monitor S contract.
p = 'hp/video/test/native-power-saving-button-layout.test.js'
s = read(p)
s = replace_once(
    s,
    '  assert.match(overlay, /L"モニターS"/);',
    '''  for (const name of ['ozeki', 'tgut', 'yuukiar', 'ten', 'nagi', 'hinata']) {
    assert.match(overlay, new RegExp(`L"モニター${name}"`));
  }''',
    'monitor button names',
)
s = replace_once(
    s,
    '  assert.doesNotMatch(overlay, /L"モニターST"|L"モニターS[1-5]"/);',
    '  assert.doesNotMatch(overlay, /L"モニターS(?:T|[1-5])"/);',
    'legacy monitor names',
)
s = replace_once(
    s,
    '  assert.match(overlay, /L"音声出力ST"/);\n  assert.match(overlay, /L"音声出力S1"/);\n  assert.match(overlay, /L"音声出力S2"/);\n  assert.match(overlay, /L"音声出力S3"/);\n  assert.match(overlay, /L"音声出力S4"/);\n  assert.match(overlay, /L"音声出力S5"/);',
    '''  for (const name of ['ozeki', 'tgut', 'yuukiar', 'ten', 'nagi', 'hinata']) {
    assert.match(overlay, new RegExp(`L"音声出力${name}"`));
  }
  assert.doesNotMatch(overlay, /L"音声出力S(?:T|[1-5])"/);''',
    'audio button names',
)
write(p, s)

replace_test(
    p,
    'monitor button cycles YT, six-Stationhead S grid, black OFF, then YT',
    r'''test('monitor button cycles YT, six named Stationhead windows, OFF, then YT', () => {
  assert.match(overlay, /controller->CycleMonitorMode\(\)/);
  assert.match(schedule, /monitorStationheadProfile_ = 6/);
  assert.match(schedule, /monitorStationheadProfile_ == 6[\s\S]*\? 1/);
  assert.match(schedule, /std::clamp\(monitorStationheadProfile_ \+ 1, 1u, 5u\)/);
  assert.match(schedule, /monitorStationheadProfile_ == 5[\s\S]*ApplyMonitorMode\(MonitorMode::Off\)/);
  assert.match(schedule, /case MonitorMode::Off:[\s\S]*ApplyMonitorMode\(MonitorMode::Native\)/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(HWND window\)/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(child\) != context->selectedProfile/);
  assert.match(routing, /const RECT target = context->parentClient/);
  assert.match(routing, /SetStationheadMonitorProfile\(selectedProfile\)/);
  assert.match(schedule, /powerSaving_ = nextPowerSaving/);
  assert.match(schedule, /ApplyStationheadMonitorPlacement\(\)/);
});''',
)
s = read(p).replace(
    "test('audio output cycles YT, Stationhead ST/S1/S2/S3/S4/S5, then OFF', () => {",
    "test('audio output cycles YT and six named Stationhead windows, then OFF', () => {",
)
write(p, s)

replace_test(
    'hp/video/test/native-monitor-dom-probe.test.js',
    'monitor S stays foreground while all six Stationhead windows participate in auth polling',
    r'''test('named Stationhead monitor selects one foreground profile while all six windows participate in auth polling', () => {
  assert.match(routing, /monitorMode_ == MonitorMode::ServiceGrid \? monitorStationheadProfile_ : 0/);
  assert.match(routing, /SetStationheadMonitorProfile\(selectedProfile\)/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(child\) != context->selectedProfile/);
  assert.match(routing, /monitorAuthSlots_/);
  assert.match(schedule, /if \(monitorMode_ != MonitorMode::Off\) \{[\s\S]*kMonitorAuthProbeIntervalMs/);
  assert.match(schedule, /if \(monitorMode_ == MonitorMode::Off \|\| powerSaving_\) return/);
});''',
)

replace_test(
    'hp/video/test/native-media-panel-layout-shift.test.js',
    'Monitor S parks six Stationhead hosts across the full screen',
    r'''test('named Stationhead monitor promotes only its selected host to the full screen', () => {
  assert.match(stationhead, /gStationheadMonitorProfile\{0\}/);
  assert.match(stationhead, /StationheadMonitorForegroundForProfile/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(HWND window\)/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(child\) != context->selectedProfile/);
  assert.match(routing, /const RECT target = context->parentClient/);
  assert.doesNotMatch(routing, /SetSpotifyMonitorGridVisible|SetSpotifyMonitorForegroundSlot/);
});''',
)

p = 'hp/video/test/stationhead-background-resource-mode.test.js'
s = read(p).replace(
    'assert.match(layout, /StationheadMonitorForeground\\(\\)/);',
    'assert.match(layout, /StationheadMonitorForegroundForProfile\\(profileName_\\)/);',
)
write(p, s)
replace_test(
    p,
    'Monitor S drives the shared playback foreground while auth promotion remains per window',
    r'''test('named Stationhead monitor drives only the selected profile foreground while auth promotion remains per window', () => {
  assert.match(routing, /SetStationheadMonitorProfile\(selectedProfile\)/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(child\) != context->selectedProfile/);
  assert.match(routing, /const bool nativeMediaForeground =\s*monitorMode_ == MonitorMode::Native && !monitorAuthForeground_/);
  assert.match(routing, /monitorAuthSlots_/);
  assert.match(routing, /PostMessageW\(parent_, WM_TIMER, 0, 0\)/);
  assert.match(bridge, /inline std::atomic<unsigned> gStationheadMonitorProfile\{0\}/);
  assert.match(layout, /ApplyHostVisualClip\(hostWindow, playbackForeground\)/);
  assert.match(layout, /authPlacement = showAuth \? HWND_TOP : HWND_BOTTOM/);
});''',
)

replace_test(
    'hp/video/test/native-monitor-s-stationhead-auth-isolation.test.js',
    'Monitor S keeps auth probing active across the six Stationhead windows',
    r'''test('named Stationhead monitors keep auth probing active across all six windows', () => {
  assert.match(schedule, /if \(monitorMode_ != MonitorMode::Off\) RequestMonitorAuthProbe\(\)/);
  assert.match(schedule, /if \(monitorMode_ == MonitorMode::Off \|\| powerSaving_\) return/);
  assert.match(schedule, /monitorAuthSlots_ = 0;[\s\S]*monitorAuthForeground_ = false/);
  assert.doesNotMatch(schedule, /SetSpotifyMonitorGridVisible|SetSpotifyMonitorForegroundSlot/);
});''',
)
replace_test(
    'hp/video/test/native-monitor-s-stationhead-auth-isolation.test.js',
    'Monitor S keeps all Stationhead playback tiles while auth surface owns its own foreground',
    r'''test('named Stationhead monitor keeps only its selected playback host in monitor foreground', () => {
  assert.match(routing, /SetStationheadMonitorProfile\(selectedProfile\)/);
  assert.match(routing, /StationheadProfileNumberFromWindow\(child\) != context->selectedProfile/);
  assert.match(routing, /const RECT target = context->parentClient/);
  assert.doesNotMatch(routing, /SetSpotifyMonitorGridVisible/);
});''',
)

replace_test(
    'hp/video/test/stationhead-background-fullsize-until-playback.test.js',
    'Monitor S maps all six Stationhead playback hosts to fixed service tiles',
    r'''test('named Stationhead monitor promotes only the selected playback host', () => {
  const apply = section(
    layout,
    'void ApplyStationheadChildLayout(',
    '}  // namespace',
  );
  assert.match(apply, /bool monitorForeground/);
  assert.match(
    apply,
    /playbackForeground\s*=\s*[\s\S]*showPlayback \|\| \(!showAuth && !hidePlayback && monitorForeground\)/,
  );
  assert.match(apply, /StationheadPlaybackControllerBounds\(\)/);

  const placement = section(
    routing,
    'void PowerSavingController::ApplyStationheadMonitorPlacement() noexcept',
    'void PowerSavingController::Detach() noexcept',
  );
  assert.match(placement, /monitorMode_ == MonitorMode::ServiceGrid \? monitorStationheadProfile_ : 0/);
  assert.match(placement, /StationheadProfileNumberFromWindow\(child\) != context->selectedProfile/);
  assert.match(placement, /SetStationheadMonitorProfile\(selectedProfile\)/);
  assert.match(placement, /const HWND insertAfter = controller->overlay_/);
  assert.match(placement, /SetWindowPos\([\s\S]*target\.left, target\.top/);
});''',
)

# Guard the requested mapping explicitly.
overlay = read('hp/native/src/power_saving_overlay.inc')
for expected in [
    '音声出力ozeki', '音声出力tgut', '音声出力yuukiar', '音声出力ten',
    '音声出力nagi', '音声出力hinata', 'モニターozeki', 'モニターtgut',
    'モニターyuukiar', 'モニターten', 'モニターnagi', 'モニターhinata',
]:
    if expected not in overlay:
        raise SystemExit(f'missing label: {expected}')
if 'StationheadMonitorForegroundForProfile(profileName_)' not in read('hp/native/src/sh_layout.cpp'):
    raise SystemExit('profile-aware Stationhead monitor routing missing')
