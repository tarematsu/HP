namespace {

thread_local RECT gDashboardClockCard{};

SidebarSections SplitRearrangedSidebarSections(const RECT& client) {
  const int height = std::max(1L, client.bottom - client.top);
  const int gap = std::max(6, height * 18 / 1000);
  const int available = std::max(3, height - gap * 2);
  const int clockHeight = available * 27 / 100;
  const int remainingHeight = std::max(2, available - clockHeight);
  const int weatherHeight = remainingHeight / 2;
  const int airHeight = std::max(1, remainingHeight - weatherHeight);

  SidebarSections sections;
  int top = client.top;
  sections.clock = RECT{client.left, top, client.right, top + clockHeight};
  top = sections.clock.bottom + gap;
  sections.weather = RECT{client.left, top, client.right, top + weatherHeight};
  top = sections.weather.bottom + gap;
  sections.controls = RECT{client.left, top, client.right, top + airHeight};
  // Electricity moved beside Music in the main column. Keep the legacy slot
  // outside the side client so old section plumbing cannot paint it twice.
  sections.energy = RECT{client.right, client.bottom, client.right + 1, client.bottom + 1};
  gDashboardClockCard = sections.clock;
  return sections;
}

MainSections SplitRearrangedMainSections(const RECT& client) {
  const int width = std::max(1L, client.right - client.left);
  const int height = std::max(1L, client.bottom - client.top);
  const int gapX = std::max(8, width * 16 / 1000);
  const int gapY = std::max(6, height * 45 / 1000);
  const int newsHeight = height * 47 / 100;
  const int rowWidth = std::max(2, width - gapX);
  const int musicWidth = std::max(1, rowWidth * 65 / 100);

  MainSections sections;
  sections.news = RECT{client.left, client.bottom - newsHeight, client.right, client.bottom};
  const LONG rowBottom = std::max(client.top + 1, sections.news.top - gapY);
  sections.music = RECT{client.left, client.top, client.left + musicWidth, rowBottom};
  // MainSections::air is the right-hand top-row slot. The rearranged dashboard
  // uses it for Electricity while Air occupies the expanded side-card slot.
  sections.air = RECT{sections.music.right + gapX, client.top, client.right, rowBottom};
  if (sections.air.right <= sections.air.left) {
    sections.air.right = sections.air.left + 1;
  }
  return sections;
}

RECT ClockControlsContent(const RECT& card) {
  const RECT content = CardContentRect(card);
  RECT controls{content.left, content.top + SpanY(content, 580), content.right, content.bottom};
  if (controls.bottom <= controls.top) controls.bottom = controls.top + 1;
  return controls;
}

RECT RearrangedClockTimeRectFromCard(const RECT& card) {
  const RECT content = CardContentRect(card);
  RECT timeRect{content.left, content.top + SpanY(content, 180),
                content.right, content.top + SpanY(content, 550)};
  if (timeRect.right <= timeRect.left) timeRect.right = timeRect.left + 1;
  if (timeRect.bottom <= timeRect.top) timeRect.bottom = timeRect.top + 1;
  return timeRect;
}

ControlsRects RearrangedControlsFromContent(const RECT&) {
  return ControlsFromContent(ClockControlsContent(gDashboardClockCard));
}

#define HP_DRAW_CLOCK_WITH_CONTROLS(dc, card) do { \
  DrawSectionCard((dc), (card)); \
  const RECT hpClockContent = CardContentRect((card)); \
  SYSTEMTIME hpNow{}; GetLocalTime(&hpNow); \
  RECT hpDateRect{hpClockContent.left, hpClockContent.top, hpClockContent.right, hpClockContent.top + SpanY(hpClockContent, 180)}; \
  RECT hpTimeRect = RearrangedClockTimeRectFromCard((card)); \
  HGDIOBJ hpPreviousFont = SelectObject((dc), TierFont(FontTier::Medium)); \
  SetTextColor((dc), kWidgetMuted); \
  DrawTextInRect((dc), DateText(hpNow), hpDateRect, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER); \
  const int hpTimeHeight = std::max(1L, hpTimeRect.bottom - hpTimeRect.top); \
  const int hpTimeWidth = std::max(1L, hpTimeRect.right - hpTimeRect.left); \
  const int hpTimeFontHeight = std::clamp(std::min(hpTimeHeight * 72 / 100, hpTimeWidth * 18 / 100), 32, 88); \
  SelectObject((dc), CachedUiFont(hpTimeFontHeight, FW_SEMIBOLD)); \
  SetTextColor((dc), kWidgetText); \
  DrawTextInRect((dc), TimeText(hpNow), hpTimeRect, DT_CENTER | DT_SINGLELINE | DT_VCENTER); \
  const ControlsRects hpControls = RearrangedControlsFromContent((card)); \
  SelectObject((dc), TierFont(FontTier::Small)); \
  DrawWidgetCard((dc), hpControls.update, kWidgetSurfaceAlt, CardRadius(hpControls.update)); \
  DrawWidgetCard((dc), hpControls.restart, kWidgetSurfaceAlt, CardRadius(hpControls.restart)); \
  SetTextColor((dc), kWidgetText); \
  DrawTextInRect((dc), L"更新", hpControls.update, DT_CENTER | DT_SINGLELINE | DT_VCENTER); \
  DrawTextInRect((dc), L"再起動", hpControls.restart, DT_CENTER | DT_SINGLELINE | DT_VCENTER); \
  if (!nativeToast_.empty()) { \
    SetTextColor((dc), kWidgetWarning); \
    DrawTextInRect((dc), nativeToast_, hpControls.status, DT_CENTER | DT_WORDBREAK | DT_END_ELLIPSIS); \
  } else { \
    std::wstring hpRadarTime; \
    bool hpHasFrame = false; \
    { std::lock_guard hpLock(radarFrameMutex_); hpRadarTime = radarTimeText_; hpHasFrame = radarFrameBitmap_ != nullptr; } \
    const std::wstring hpStatus = hpHasFrame ? L"レーダー更新: " + (hpRadarTime.empty() ? L"--:--" : hpRadarTime) : L"レーダーを準備中"; \
    const int hpStatusHeight = static_cast<int>(hpControls.status.bottom - hpControls.status.top); \
    RECT hpFirstLine = hpControls.status; hpFirstLine.bottom = hpControls.status.top + hpStatusHeight / 2; \
    RECT hpSecondLine = hpControls.status; hpSecondLine.top = hpFirstLine.bottom; \
    SetTextColor((dc), kWidgetMuted); \
    DrawTextInRect((dc), hpStatus, hpFirstLine, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER); \
    if (!nativeAppVersion_.empty()) { \
      SetTextColor((dc), kWidgetSubtle); \
      DrawTextInRect((dc), L"バージョン " + nativeAppVersion_, hpSecondLine, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER); \
    } \
  } \
  SelectObject((dc), hpPreviousFont); \
} while (false)

}  // namespace
