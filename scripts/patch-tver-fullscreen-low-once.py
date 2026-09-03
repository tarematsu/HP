from pathlib import Path

media_path = Path('hp/native/src/renderer_panels/media_section.inc')
media = media_path.read_text(encoding='utf-8')

media = media.replace(
    'constexpr UINT_PTR kNativeMediaYoutubeWatchdogTimer = 0x4D560006;\n',
    'constexpr UINT_PTR kNativeMediaYoutubeWatchdogTimer = 0x4D560006;\n'
    'constexpr UINT_PTR kNativeMediaTverWatchdogTimer = 0x4D560007;\n',
    1,
)
media = media.replace(
    'constexpr UINT kNativeMediaYoutubeWatchdogMaxMs = 10U * 1000U;\n',
    'constexpr UINT kNativeMediaYoutubeWatchdogMaxMs = 10U * 1000U;\n'
    'constexpr UINT kNativeMediaTverWatchdogMs = 2U * 1000U;\n',
    1,
)

anchor = 'LRESULT CALLBACK NativeMediaPanelWndProc(HWND, UINT, WPARAM, LPARAM);\n'
if 'kNativeMediaTverWatchdogScript' not in media:
    script = r'''constexpr wchar_t kNativeMediaTverWatchdogScript[] = LR"JS(
(() => {
  if (location.hostname !== 'tver.jp' ||
      !location.pathname.startsWith('/episodes/')) return null;
  const normalize = value => (value || '').replace(/\s+/g, ' ').trim();
  const visible = element => {
    if (!element || element.disabled ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' &&
           style.pointerEvents !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const labelOf = element => normalize(
      (element.getAttribute('aria-label') || '') + ' ' +
      (element.getAttribute('title') || '') + ' ' +
      (element.textContent || ''));
  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
  const controls = Array.from(document.querySelectorAll(
      'button, [role="button"], [role="menuitem"], [role="radio"], '
      + '[role="option"], li'));
  const state = window.__homePanelTverPlayerPrefs ||
      (window.__homePanelTverPlayerPrefs = {
        lowQualitySet: false,
        lowClickPending: false,
      });
  const selected = element =>
      element.getAttribute('aria-checked') === 'true' ||
      element.getAttribute('aria-selected') === 'true' ||
      element.getAttribute('data-state') === 'checked' ||
      /選択中|設定中/.test(labelOf(element));
  const lowOption = controls.find(element => {
    if (!visible(element)) return false;
    const label = labelOf(element);
    return label === '低' || label === '低画質' ||
           /^低(?:\s|$)/.test(label) || /低画質/.test(label);
  }) || null;

  if (!state.lowQualitySet) {
    if (state.lowClickPending && !lowOption) {
      state.lowQualitySet = true;
      state.lowClickPending = false;
    } else if (lowOption) {
      if (selected(lowOption)) {
        state.lowQualitySet = true;
        state.lowClickPending = false;
      } else {
        state.lowClickPending = true;
        return point(lowOption);
      }
    }
    if (!state.lowQualitySet) {
      const quality = controls.find(element =>
          visible(element) && /(^|\s)画質($|\s)|画質設定/.test(labelOf(element)));
      if (quality) return point(quality);
      const settings = controls.find(element => {
        if (!visible(element)) return false;
        const label = labelOf(element).toLowerCase();
        return label === '設定' || label.includes('プレイヤー設定') ||
               label === 'settings' || label.includes('setting');
      });
      if (settings) return point(settings);
      return null;
    }
  }

  const fullscreen = document.fullscreenElement || document.webkitFullscreenElement ||
      controls.some(element => {
        if (!visible(element)) return false;
        const label = labelOf(element).toLowerCase();
        return /全画面を終了|全画面解除|フルスクリーンを終了/.test(label) ||
               label.includes('exit fullscreen');
      });
  if (fullscreen) return null;
  const fullscreenButton = controls.find(element => {
    if (!visible(element)) return false;
    const label = labelOf(element).toLowerCase();
    if (/終了|解除/.test(label) || label.includes('exit fullscreen')) return false;
    return /全画面|フルスクリーン/.test(label) || label.includes('fullscreen');
  });
  return fullscreenButton ? point(fullscreenButton) : null;
})()
)JS";

'''
    media = media.replace(anchor, script + anchor, 1)

media = media.replace(
    '''    if (timerId == kNativeMediaYoutubeWatchdogTimer) {
      if (hostWindow_ && IsWindow(hostWindow_)) {
        SetTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer,
                 NextNativeMediaYoutubeWatchdogMs(), nullptr);
      }
      ProbeYoutubeWatchdog();
      return true;
    }
''',
    '''    if (timerId == kNativeMediaYoutubeWatchdogTimer) {
      if (hostWindow_ && IsWindow(hostWindow_)) {
        SetTimer(hostWindow_, kNativeMediaYoutubeWatchdogTimer,
                 NextNativeMediaYoutubeWatchdogMs(), nullptr);
      }
      ProbeYoutubeWatchdog();
      return true;
    }
    if (timerId == kNativeMediaTverWatchdogTimer) {
      ProbeTverWatchdog();
      return true;
    }
''',
    1,
)

media = media.replace(
    '''    StopYoutubeMonitors();
    StopNavigationRetry();
''',
    '''    StopYoutubeMonitors();
    StopTverPlaybackMonitor();
    StopNavigationRetry();
''',
    1,
)

media = media.replace(
    '''                if (FAILED(args->get_IsSuccess(&succeeded)) || !succeeded) {
                  StopYoutubeMonitors();
                  ScheduleNavigationRetry();
                  return S_OK;
                }
''',
    '''                if (FAILED(args->get_IsSuccess(&succeeded)) || !succeeded) {
                  StopYoutubeMonitors();
                  StopTverPlaybackMonitor();
                  ScheduleNavigationRetry();
                  return S_OK;
                }
''',
    1,
)
media = media.replace(
    '''                if (phase_ == Phase::Tver && IsTverPage()) {
                  StopYoutubeMonitors();
                  webview_->ExecuteScript(kNativeMediaTverLoopScript, nullptr);
                } else if (phase_ == Phase::YouTube && IsYoutubePlaylistPage()) {
                  StopYoutubePlaybackMonitors();
                  BeginPlayAllProbe();
                } else if (phase_ == Phase::YouTube && IsYoutubeWatchPage()) {
                  StopPlayAllProbe();
                  BeginYoutubePlaybackMonitors();
                } else {
                  StopYoutubeMonitors();
                }
''',
    '''                if (phase_ == Phase::Tver && IsTverPage()) {
                  StopYoutubeMonitors();
                  webview_->ExecuteScript(kNativeMediaTverLoopScript, nullptr);
                  BeginTverPlaybackMonitor();
                } else if (phase_ == Phase::YouTube && IsYoutubePlaylistPage()) {
                  StopTverPlaybackMonitor();
                  StopYoutubePlaybackMonitors();
                  BeginPlayAllProbe();
                } else if (phase_ == Phase::YouTube && IsYoutubeWatchPage()) {
                  StopTverPlaybackMonitor();
                  StopPlayAllProbe();
                  BeginYoutubePlaybackMonitors();
                } else {
                  StopYoutubeMonitors();
                  StopTverPlaybackMonitor();
                }
''',
    1,
)

media = media.replace(
    '''    StopYoutubeMonitors();
    StopNavigationRetry();
    CloseController();
''',
    '''    StopYoutubeMonitors();
    StopTverPlaybackMonitor();
    StopNavigationRetry();
    CloseController();
''',
    2,
)

monitor_anchor = '''  void StopYoutubeMonitors() noexcept {
    StopPlayAllProbe();
    StopYoutubePlaybackMonitors();
  }

'''
if 'void BeginTverPlaybackMonitor() noexcept' not in media:
    methods = '''  void BeginTverPlaybackMonitor() noexcept {
    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
    tverWatchdogInFlight_ = false;
    KillTimer(hostWindow_, kNativeMediaTverWatchdogTimer);
    SetTimer(hostWindow_, kNativeMediaTverWatchdogTimer,
             kNativeMediaTverWatchdogMs, nullptr);
    ProbeTverWatchdog();
  }

  void StopTverPlaybackMonitor() noexcept {
    if (hostWindow_ && IsWindow(hostWindow_)) {
      KillTimer(hostWindow_, kNativeMediaTverWatchdogTimer);
    }
    tverWatchdogInFlight_ = false;
  }

'''
    media = media.replace(monitor_anchor, monitor_anchor + methods, 1)

probe_anchor = '''  static LONG AbsoluteMouseCoordinate(int value, int origin, int span) noexcept {
'''
if 'void ProbeTverWatchdog() noexcept' not in media:
    probe = '''  void ProbeTverWatchdog() noexcept {
    if (phase_ != Phase::Tver || !webview_ || tverWatchdogInFlight_ ||
        !IsTverPage()) return;
    tverWatchdogInFlight_ = true;
    const auto alive = alive_;
    const HRESULT started = webview_->ExecuteScript(
        kNativeMediaTverWatchdogScript,
        Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this, alive](HRESULT result, LPCWSTR json) -> HRESULT {
              if (!alive->load(std::memory_order_acquire)) return S_OK;
              tverWatchdogInFlight_ = false;
              if (phase_ != Phase::Tver || !IsTverPage()) return S_OK;
              int x = 0;
              int y = 0;
              if (SUCCEEDED(result) && ParseNormalizedPoint(json, &x, &y)) {
                ClickNormalizedPoint(x, y);
              }
              return S_OK;
            }).Get());
    if (FAILED(started)) tverWatchdogInFlight_ = false;
  }

'''
    media = media.replace(probe_anchor, probe + probe_anchor, 1)

media = media.replace(
    '''    if (phase_ != Phase::YouTube || !hostWindow_ || !IsWindow(hostWindow_)) return;
''',
    '''    if (!hostWindow_ || !IsWindow(hostWindow_)) return;
''',
    1,
)

media = media.replace(
    '''    StopYoutubeMonitors();
    StopNavigationRetry();
    if (hostWindow_ && IsWindow(hostWindow_)) {
''',
    '''    StopYoutubeMonitors();
    StopTverPlaybackMonitor();
    StopNavigationRetry();
    if (hostWindow_ && IsWindow(hostWindow_)) {
''',
    1,
)

media = media.replace(
    '''  bool youtubeWatchdogInFlight_ = false;
  bool failed_ = false;
''',
    '''  bool youtubeWatchdogInFlight_ = false;
  bool tverWatchdogInFlight_ = false;
  bool failed_ = false;
''',
    1,
)

media_path.write_text(media, encoding='utf-8')

# Remove a redundant C++ URL constant from the Spotify change; the JS target URL remains.
spotify_path = Path('hp/native/src/spotify_webviews.cpp')
spotify = spotify_path.read_text(encoding='utf-8')
spotify = spotify.replace(
    'constexpr wchar_t kSpotifyTokyoSnowUrl[] =\n'
    '    L"https://open.spotify.com/track/307SI8AgVvBbNTkNrETKHW";\n',
    '',
    1,
)
spotify_path.write_text(spotify, encoding='utf-8')

test_path = Path('hp/video/test/native-mv-panel-contract.test.js')
tests = test_path.read_text(encoding='utf-8')
old = '''test('TVer phase opens Sakura Meets latest episode and loops it at 1.75x', () => {
  assert.match(mediaPanel, /https:\\/\\/tver\\.jp\\/series\\/srx97ftk3w/);
  assert.match(mediaPanel, /querySelectorAll\\('a\\[href\\*=\"\\/episodes\\/\"\\]'\\)/);
  assert.match(mediaPanel, /最新話\\|最新回/);
  assert.match(mediaPanel, /放課後トーク\\|予告/);
  assert.match(mediaPanel, /const playbackRate = 1\\.75/);
  assert.match(mediaPanel, /video\\.defaultPlaybackRate = playbackRate/);
  assert.match(mediaPanel, /video\\.playbackRate = playbackRate/);
  assert.match(mediaPanel, /video\\.ended && state\\.maxDuration >= 600 && state\\.maxTime >= 300/);
  assert.match(mediaPanel, /location\\.replace\\(seriesUrl\\)/);
  assert.match(mediaPanel, /window\\.setInterval\\(ensure, 2000\\)/);
});
'''
new = '''test('TVer opens Sakura Meets latest episode at 1.75x, low quality, and fullscreen', () => {
  assert.match(mediaPanel, /https:\\/\\/tver\\.jp\\/series\\/srx97ftk3w/);
  assert.match(mediaPanel, /querySelectorAll\\('a\\[href\\*=\"\\/episodes\\/\"\\]'\\)/);
  assert.match(mediaPanel, /最新話\\|最新回/);
  assert.match(mediaPanel, /放課後トーク\\|予告/);
  assert.match(mediaPanel, /const playbackRate = 1\\.75/);
  assert.match(mediaPanel, /video\\.defaultPlaybackRate = playbackRate/);
  assert.match(mediaPanel, /video\\.playbackRate = playbackRate/);
  assert.match(mediaPanel, /video\\.ended && state\\.maxDuration >= 600 && state\\.maxTime >= 300/);
  assert.match(mediaPanel, /location\\.replace\\(seriesUrl\\)/);
  assert.match(mediaPanel, /window\\.setInterval\\(ensure, 2000\\)/);
  assert.match(mediaPanel, /kNativeMediaTverWatchdogTimer = 0x4D560007/);
  assert.match(mediaPanel, /kNativeMediaTverWatchdogMs = 2U \\* 1000U/);
  assert.match(mediaPanel, /kNativeMediaTverWatchdogScript/);
  assert.match(mediaPanel, /lowQualitySet/);
  assert.match(mediaPanel, /低画質/);
  assert.match(mediaPanel, /画質設定/);
  assert.match(mediaPanel, /document\\.fullscreenElement/);
  assert.match(mediaPanel, /全画面/);
  assert.match(mediaPanel, /BeginTverPlaybackMonitor\\(\\)/);
  assert.match(mediaPanel, /ProbeTverWatchdog\\(\\)/);
  assert.match(
    mediaPanel,
    /timerId == kNativeMediaTverWatchdogTimer[\\s\\S]*ProbeTverWatchdog\\(\\)/,
  );
});
'''
if old not in tests:
    raise SystemExit('TVer test block not found')
tests = tests.replace(old, new, 1)
test_path.write_text(tests, encoding='utf-8')
