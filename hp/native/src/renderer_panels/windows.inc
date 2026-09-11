namespace {
bool EnsureNativeMvPanel(HWND parentWindow, const fs::path& dataDir,
                         const RECT& bounds) noexcept;

UINT NativePanelTickDelayToNextSecond() noexcept {
  return NetworkClockDelayToNextSecond();
}
}

const std::array<Renderer::NativePanelSlot, 3>& Renderer::NativePanelSlots() {
  static const std::array<NativePanelSlot, 3> slots{{
      {&Renderer::nativeMediaWindow_, &NativeDashboardLayout::media,
       L"HomePanelNativeMedia", kNativeMediaId},
      {&Renderer::nativeSideWindow_, &NativeDashboardLayout::side,
       L"HomePanelNativeSide", kNativeSideId},
      {&Renderer::nativeMainWindow_, &NativeDashboardLayout::main,
       L"HomePanelNativeMain", kNativeMainId},
  }};
  return slots;
}

HFONT Renderer::TierFont(FontTier tier) const {
  const int clientHeight = std::max(1L, bounds_.bottom - bounds_.top);
  switch (tier) {
    case FontTier::Small:
      return CachedUiFont(std::clamp(clientHeight * 14 / 1000, 12, 24), FW_NORMAL);
    case FontTier::Medium:
      return CachedUiFont(std::clamp(clientHeight * 21 / 1000, 16, 36), FW_SEMIBOLD);
    case FontTier::Large:
    default:
      return CachedUiFont(std::clamp(clientHeight * 56 / 1000, 36, 112), FW_SEMIBOLD);
  }
}

Renderer::NativePanelPaintScope::NativePanelPaintScope(Renderer& renderer, HWND target)
    : hwnd(target) {
  paintDc = BeginPaint(hwnd, &paint);
  if (!paintDc) return;
  try {
    GetClientRect(hwnd, &bounds);
    dirty = paint.rcPaint;
    if (IsRectEmpty(&dirty)) dirty = bounds;
    IntersectRect(&dirty, &dirty, &bounds);
    dc = NativePanelMemoryDc(paintDc);
    HBITMAP bitmap = renderer.NativePanelBackBuffer(
        hwnd, paintDc, std::max(1L, bounds.right), std::max(1L, bounds.bottom));
    if (!dc || !bitmap) {
      dc = nullptr;
      FillWidgetBackground(paintDc, bounds);
      return;
    }
    SelectClipRgn(dc, nullptr);
    previousBitmap = SelectObject(dc, bitmap);
    if (!previousBitmap || previousBitmap == HGDI_ERROR) {
      previousBitmap = nullptr;
      dc = nullptr;
      FillWidgetBackground(paintDc, bounds);
      return;
    }
    IntersectClipRect(dc, dirty.left, dirty.top, dirty.right, dirty.bottom);
    FillWidgetBackground(dc, dirty);
    SetBkMode(dc, TRANSPARENT);
  } catch (...) {
    if (dc && previousBitmap) {
      SelectClipRgn(dc, nullptr);
      SelectObject(dc, previousBitmap);
    }
    EndPaint(hwnd, &paint);
    paintDc = nullptr;
    dc = nullptr;
    previousBitmap = nullptr;
    throw;
  }
}

Renderer::NativePanelPaintScope::~NativePanelPaintScope() {
  if (!paintDc) return;
  if (dc) {
    BitBlt(paintDc, dirty.left, dirty.top, dirty.right - dirty.left, dirty.bottom - dirty.top,
           dc, dirty.left, dirty.top, SRCCOPY);
    SelectClipRgn(dc, nullptr);
    if (previousBitmap) SelectObject(dc, previousBitmap);
  }
  EndPaint(hwnd, &paint);
}

bool Renderer::EnsureNativeStaticWindows() {
  if (!window_ || !IsWindow(window_)) return false;
  static constexpr wchar_t kStaticClassName[] = L"HomePanelNativeStaticPanel";
  static std::once_flag classOnce;
  std::call_once(classOnce, [] {
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = Renderer::NativeWndProcThunk<&Renderer::HandleNativeStaticMessage>;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kStaticClassName;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = nullptr;
    SetLastError(ERROR_SUCCESS);
    if (!RegisterClassW(&windowClass) &&
        GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
      throw std::runtime_error("native dashboard window class registration failed");
    }
  });

  const NativeDashboardLayout layout = ComputeNativeDashboardLayout(bounds_);
  bool allCreated = true;
  bool createdAny = false;
  for (const NativePanelSlot& slot : NativePanelSlots()) {
    HWND& hwnd = this->*slot.window;
    if (hwnd && IsWindow(hwnd)) continue;
    const RECT rect = layout.*slot.rect;
    hwnd = CreateWindowExW(0, kStaticClassName, slot.title,
        WS_CHILD | WS_CLIPSIBLINGS | WS_VISIBLE,
        rect.left, rect.top, std::max(1L, rect.right - rect.left),
        std::max(1L, rect.bottom - rect.top), window_,
        reinterpret_cast<HMENU>(static_cast<INT_PTR>(slot.id)),
        GetModuleHandleW(nullptr), this);
    const bool created = hwnd && IsWindow(hwnd);
    allCreated = allCreated && created;
    createdAny = createdAny || created;
  }
  if (createdAny) {
    ApplyNativeStaticBounds();
    if (nativeDashboardVisible_ && nativeMainWindow_ && IsWindow(nativeMainWindow_)) {
      nativePanelTimerActive_ =
          SetTimer(nativeMainWindow_, kNativePanelTickTimer,
                   NativePanelTickDelayToNextSecond(), nullptr) != 0;
    } else {
      nativePanelTimerActive_ = false;
    }
  }

  // Do not create or navigate the YouTube/TVer WebView while power saving hides
  // the dashboard. The media container exists only to host that WebView.
  if (nativeDashboardVisible_ && nativeMediaWindow_ && IsWindow(nativeMediaWindow_)) {
    RECT mediaBounds{};
    GetClientRect(nativeMediaWindow_, &mediaBounds);
    if (mediaBounds.right > mediaBounds.left && mediaBounds.bottom > mediaBounds.top) {
      allCreated = EnsureNativeMvPanel(nativeMediaWindow_, dataDir_, mediaBounds) && allCreated;
    }
  }
  return allCreated;
}

void Renderer::ApplyNativeStaticBounds() {
  const NativeDashboardLayout layout = ComputeNativeDashboardLayout(bounds_);
  for (const NativePanelSlot& slot : NativePanelSlots()) {
    const HWND hwnd = this->*slot.window;
    if (!hwnd || !IsWindow(hwnd)) continue;
    PlaceNativeWindow(hwnd, layout.*slot.rect, nativeDashboardVisible_);
    InvalidateRect(hwnd, nullptr, FALSE);
  }
}

void Renderer::InvalidateAllNativePanels() {
  for (const NativePanelSlot& slot : NativePanelSlots()) {
    const HWND hwnd = this->*slot.window;
    if (hwnd && IsWindow(hwnd)) InvalidateRect(hwnd, nullptr, FALSE);
  }
}

void Renderer::InvalidatePanelSection(HWND window, PanelSection section) {
  if (!window || !IsWindow(window)) return;
  RECT client{};
  GetClientRect(window, &client);
  RECT rect = client;
  if (window == nativeSideWindow_) {
    const SidebarSections sections = SplitSidebarSections(client);
    switch (section) {
      case PanelSection::Clock: rect = sections.clock; break;
      case PanelSection::ClockTime: rect = ClockTimeRectFromCard(sections.clock); break;
      case PanelSection::Weather: rect = sections.weather; break;
      case PanelSection::AirStats:
        rect = RearrangedAirStatsRectFromCard(sections.controls);
        break;
      case PanelSection::AirGraph:
        rect = RearrangedAirGraphRectFromCard(sections.controls);
        break;
      default: break;
    }
  } else if (window == nativeMainWindow_) {
    const MainSections sections = SplitMainSections(client);
    switch (section) {
      case PanelSection::Radar: rect = sections.radar; break;
      case PanelSection::PlaybackProgress:
        rect = MusicProgressRectFromBody(CardBodyRect(CardContentRect(sections.radar)));
        break;
      case PanelSection::Energy: rect = sections.energy; break;
      case PanelSection::EnergySwitchBot:
        rect = EnergySwitchBotRectFromCard(
            sections.energy, nativeDashboard_.switchBotDevices.size());
        break;
      default: break;
    }
  }
  InvalidateRect(window, &rect, FALSE);
}

void Renderer::DestroyNativeStaticWindows() {
  if (nativeMainWindow_ && IsWindow(nativeMainWindow_)) {
    KillTimer(nativeMainWindow_, kNativePanelTickTimer);
  }
  nativePanelTimerActive_ = false;
  nativeClockReady_ = false;
  nativeClockNow_ = {};
  nativeClockDateText_ = L"時刻同期中";
  nativeClockTimeText_ = L"--:--:--";
  nativeClockDayKey_ = 0;
  nativeClockSecondKey_ = -1;
  nativePlaybackTickState_ = {};
  for (const NativePanelSlot& slot : NativePanelSlots()) {
    const HWND hwnd = this->*slot.window;
    if (hwnd && IsWindow(hwnd)) DestroyWindow(hwnd);
  }
  ResetNativeBitmapCaches();
  {
    std::lock_guard lock(radarFrameMutex_);
    if (radarFrameBitmap_) DeleteObject(radarFrameBitmap_);
    radarFrameBitmap_ = nullptr;
  }
  for (const NativePanelSlot& slot : NativePanelSlots()) this->*slot.window = nullptr;
}

LRESULT Renderer::HandleNativeStaticMessage(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  // These are independent child HWND callbacks. The parent HomePanel WndProc
  // protection does not wrap them, so an allocation/JSON/GDI helper exception
  // used to escape through user32 and terminate the process without the normal
  // "HomePanel exiting" log. Keep the process alive and finish WM_PAINT even
  // when one native panel frame cannot be produced.
  try {
    switch (message) {
      case WM_ERASEBKGND:
        return 1;
      case WM_TIMER:
        if (wparam == kNativePanelTickTimer && hwnd == nativeMainWindow_) {
          TickNativePanels(UnixMillis(), true);
          nativePanelTimerActive_ =
              SetTimer(hwnd, kNativePanelTickTimer,
                       NativePanelTickDelayToNextSecond(), nullptr) != 0;
          return 0;
        }
        break;
      case WM_LBUTTONUP:
        // Main and side cards are display-only. Interactive power/mute controls
        // are owned by PowerSavingController's overlay, not these panels.
        return 0;
      case WM_PAINT:
        if (GetDlgCtrlID(hwnd) == kNativeSideId) PaintNativeSide(hwnd);
        else if (GetDlgCtrlID(hwnd) == kNativeMainId) PaintNativeMain(hwnd);
        else PaintNativeMedia(hwnd);
        return 0;
      case WM_NCDESTROY:
        if (hwnd == nativeMainWindow_) nativePanelTimerActive_ = false;
        ReleaseNativePanelBackBuffer(hwnd);
        for (const NativePanelSlot& slot : NativePanelSlots()) {
          if (this->*slot.window == hwnd) this->*slot.window = nullptr;
        }
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        break;
    }
    return DefWindowProcW(hwnd, message, wparam, lparam);
  } catch (...) {
    OutputDebugStringW(L"HomePanel native dashboard callback failed\n");
    if (message == WM_PAINT) ValidateRect(hwnd, nullptr);
    if (message == WM_TIMER && hwnd == nativeMainWindow_) {
      KillTimer(hwnd, kNativePanelTickTimer);
      nativePanelTimerActive_ = false;
    }
    return 0;
  }
}

void Renderer::PaintNativeSide(HWND hwnd) {
  NativePanelPaintScope scope(*this, hwnd);
  if (!scope.Valid()) return;
  const SidebarSections sections = SplitSidebarSections(scope.bounds);
  RECT overlap{};
  if (IntersectRect(&overlap, &scope.dirty, &sections.clock)) {
    DrawClockSection(scope.dc, sections.clock);
  }
  if (IntersectRect(&overlap, &scope.dirty, &sections.weather)) {
    DrawWeatherSection(scope.dc, sections.weather);
  }
  if (IntersectRect(&overlap, &scope.dirty, &sections.controls)) {
    DrawControlsSection(scope.dc, sections.controls);
  }
}

void Renderer::PaintNativeMain(HWND hwnd) {
  NativePanelPaintScope scope(*this, hwnd);
  if (!scope.Valid()) return;
  const MainSections sections = SplitMainSections(scope.bounds);
  RECT overlap{};
  if (IntersectRect(&overlap, &scope.dirty, &sections.radar)) {
    DrawRadarSection(scope.dc, sections.radar);
  }
  if (IntersectRect(&overlap, &scope.dirty, &sections.energy)) {
    const RECT switchBotRect = EnergySwitchBotRectFromCard(
        sections.energy, nativeDashboard_.switchBotDevices.size());
    const bool switchBotOnly =
        scope.dirty.left >= switchBotRect.left &&
        scope.dirty.top >= switchBotRect.top &&
        scope.dirty.right <= switchBotRect.right &&
        scope.dirty.bottom <= switchBotRect.bottom;
    if (!switchBotOnly) DrawEnergySection(scope.dc, sections.energy);

    RECT switchBotOverlap{};
    if (IntersectRect(&switchBotOverlap, &scope.dirty, &switchBotRect)) {
      DrawEnergySwitchBotSection(scope.dc, sections.energy);
    }
  }
}

void Renderer::PaintNativeMedia(HWND hwnd) {
  NativePanelPaintScope scope(*this, hwnd);
  if (!scope.Valid()) return;

  // This parent is only a WebView host. Never paint the rain-radar bitmap here:
  // if WebView2 is momentarily unavailable during mute/navigation/controller
  // transitions, the fallback must stay black instead of exposing the radar.
  FillRect(scope.dc, &scope.bounds,
           static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
}
