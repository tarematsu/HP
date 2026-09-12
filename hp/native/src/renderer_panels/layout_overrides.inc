namespace {

SidebarSections SplitRearrangedSidebarSections(const RECT& client) {
  const int height = std::max(1L, client.bottom - client.top);
  const int gap = std::max(6, height * 18 / 1000);
  // NativeDashboardLayout::media is the upper YouTube/TVer WebView host. The
  // visible rain-radar card is in the lower main row, whose exact height is the
  // full side height minus that 60% media host and the inter-row gap.
  const int upperMediaHeight = height * 600 / 1000;
  const int weatherHeight =
      std::max(1, height - upperMediaHeight - gap);
  const int compactAvailable =
      std::max(2, height - weatherHeight - gap * 2);
  const int clockHeight = std::max(1, compactAvailable * 55 / 100);
  const int airHeight = std::max(1, compactAvailable - clockHeight);

  SidebarSections sections;
  int top = client.top;
  sections.clock = RECT{client.left, top, client.right, top + clockHeight};
  top = sections.clock.bottom + gap;
  // Air and Weather intentionally trade their previous positions. Keep Air in
  // the middle slot and make Weather exactly as tall as the visible radar card.
  sections.controls = RECT{client.left, top, client.right, top + airHeight};
  top = sections.controls.bottom + gap;
  sections.weather = RECT{client.left, top, client.right, top + weatherHeight};
  // Electricity moved beside the radar in the main column. Keep the legacy
  // sidebar slot outside the client so old section plumbing cannot paint twice.
  sections.energy = RECT{client.right, client.bottom, client.right + 1, client.bottom + 1};
  return sections;
}

struct RearrangedMainLayout {
  MainSections sections{};
};

RearrangedMainLayout ComputeRearrangedMainLayout(const RECT& client) {
  const int width = std::max(1L, client.right - client.left);
  const int gapX = std::max(8, width * 16 / 1000);
  const int rowWidth = std::max(2, width - gapX);
  const int leftWidth = std::max(1, rowWidth * 65 / 100);

  RearrangedMainLayout layout;
  layout.sections.radar =
      RECT{client.left, client.top, client.left + leftWidth, client.bottom};
  layout.sections.energy =
      RECT{layout.sections.radar.right + gapX, client.top, client.right, client.bottom};
  if (layout.sections.radar.right <= layout.sections.radar.left) {
    layout.sections.radar.right = layout.sections.radar.left + 1;
  }
  if (layout.sections.radar.bottom <= layout.sections.radar.top) {
    layout.sections.radar.bottom = layout.sections.radar.top + 1;
  }
  if (layout.sections.energy.right <= layout.sections.energy.left) {
    layout.sections.energy.right = layout.sections.energy.left + 1;
  }
  return layout;
}

MainSections SplitRearrangedMainSections(const RECT& client) {
  return ComputeRearrangedMainLayout(client).sections;
}

RECT RearrangedClockTimeRectFromCard(const RECT& card) {
  const RECT content = CardContentRect(card);
  // The one-second tick changes only the large time text. The waste summary and
  // version footer are date/static content and do not need second-by-second repainting.
  RECT timeRect{content.left, content.top + SpanY(content, 170),
                content.right, content.top + SpanY(content, 650)};
  if (timeRect.right <= timeRect.left) timeRect.right = timeRect.left + 1;
  if (timeRect.bottom <= timeRect.top) timeRect.bottom = timeRect.top + 1;
  return timeRect;
}

RECT RearrangedAirStatsRectFromCard(const RECT& card) {
  const RECT body = CardContentRect(card);
  const int statsHeight = SpanY(body, 270);
  RECT rect{body.left, body.top, body.right, body.top + statsHeight};
  if (rect.bottom <= rect.top) rect.bottom = rect.top + 1;
  return rect;
}

RECT RearrangedAirGraphRectFromCard(const RECT& card) {
  const RECT body = CardContentRect(card);
  const int statsHeight = SpanY(body, 270);
  const int plotTop = body.top + statsHeight + SpanY(body, 60);
  RECT rect{body.left, plotTop, body.right, body.bottom};
  if (rect.bottom <= rect.top) rect.bottom = rect.top + 1;
  return rect;
}

RECT EnergySwitchBotRectFromCard(const RECT& card, size_t deviceCount) {
  const RECT body = CardContentRect(card);
  const size_t boundedCount = std::min<size_t>(4, deviceCount);
  const int plugLineHeight = std::clamp(SpanY(body, 110), 12, 22);
  const int plugRowGap = std::max(1, SpanY(body, 10));
  const int plugRowCount = boundedCount > 2 ? 2 : 1;
  const int plugHeight =
      plugLineHeight * plugRowCount + plugRowGap * (plugRowCount - 1);
  RECT rect{body.left, body.bottom - plugHeight, body.right, body.bottom};
  if (rect.bottom <= rect.top) rect.bottom = rect.top + 1;
  return rect;
}

void DrawFixedWidthClockTime(HDC dc, const std::wstring& text,
                             const RECT& rect) {
  if (text.empty() || rect.right <= rect.left || rect.bottom <= rect.top) return;

  int digitCellWidth = 1;
  for (wchar_t digit = L'0'; digit <= L'9'; ++digit) {
    SIZE extent{};
    if (GetTextExtentPoint32W(dc, &digit, 1, &extent)) {
      digitCellWidth = std::max(digitCellWidth, static_cast<int>(extent.cx));
    }
  }
  const int separatorCellWidth = std::max(1, digitCellWidth * 45 / 100);

  int totalWidth = 0;
  for (const wchar_t character : text) {
    totalWidth += character >= L'0' && character <= L'9'
        ? digitCellWidth
        : separatorCellWidth;
  }

  const int availableWidth =
      std::max(1, static_cast<int>(rect.right - rect.left));
  LONG left = rect.left + std::max(0, (availableWidth - totalWidth) / 2);
  for (const wchar_t character : text) {
    const int cellWidth = character >= L'0' && character <= L'9'
        ? digitCellWidth
        : separatorCellWidth;
    RECT cell{left, rect.top,
              std::min<LONG>(rect.right, left + cellWidth), rect.bottom};
    if (cell.right <= cell.left) break;
    const wchar_t glyph[2]{character, L'\0'};
    DrawTextInRect(dc, glyph, cell,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    left += cellWidth;
    if (left >= rect.right) break;
  }
}

#define HP_DRAW_CLOCK_WITH_STATUS(dc, card) do { \
  DrawSectionCard((dc), (card)); \
  const RECT hpClockContent = CardContentRect((card)); \
  RECT hpDateRect{hpClockContent.left, hpClockContent.top, hpClockContent.right, hpClockContent.top + SpanY(hpClockContent, 170)}; \
  RECT hpTimeRect{hpClockContent.left, hpDateRect.bottom, hpClockContent.right, hpClockContent.top + SpanY(hpClockContent, 650)}; \
  RECT hpWasteRect{hpClockContent.left, hpTimeRect.bottom, hpClockContent.right, hpClockContent.top + SpanY(hpClockContent, 780)}; \
  RECT hpStatusRect{hpClockContent.left, hpClockContent.top + SpanY(hpClockContent, 790), hpClockContent.right, hpClockContent.bottom}; \
  HGDIOBJ hpPreviousFont = SelectObject((dc), TierFont(FontTier::Medium)); \
  SetTextColor((dc), kWidgetMuted); \
  DrawTextInRect((dc), nativeClockDateText_, hpDateRect, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER); \
  const int hpTimeHeight = std::max(1L, hpTimeRect.bottom - hpTimeRect.top); \
  const int hpTimeWidth = std::max(1L, hpTimeRect.right - hpTimeRect.left); \
  const int hpTimeFontHeight = std::clamp(std::min(hpTimeHeight * 72 / 100, hpTimeWidth * 18 / 100), 32, 88); \
  SelectObject((dc), CachedUiFont(hpTimeFontHeight, FW_SEMIBOLD)); \
  SetTextColor((dc), kWidgetText); \
  DrawFixedWidthClockTime((dc), nativeClockTimeText_, hpTimeRect); \
  const std::wstring hpWasteText = nativeClockReady_ ? Course36ClockWasteSummary(nativeClockNow_) : std::wstring{}; \
  SelectObject((dc), TierFont(FontTier::Medium)); \
  SetTextColor((dc), kWidgetText); \
  DrawTextInRect((dc), hpWasteText, hpWasteRect, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER); \
  const std::wstring hpVersionText = kVersion; \
  const int hpControlButtonWidth = std::clamp(SpanX(hpStatusRect, 205), 74, 110); \
  const int hpControlButtonGap = std::clamp(SpanX(hpStatusRect, 20), 6, 12); \
  const int hpControlRowWidth = hpControlButtonWidth * 3 + hpControlButtonGap * 2; \
  const LONG hpStatusTextRight = std::max<LONG>(hpStatusRect.left + 1, hpStatusRect.right - hpControlRowWidth - hpControlButtonGap); \
  RECT hpVersionRect = hpStatusRect; hpVersionRect.right = hpStatusTextRight; \
  SelectObject((dc), TierFont(FontTier::Small)); \
  SetTextColor((dc), kWidgetMuted); \
  DrawTextInRect((dc), hpVersionText, hpVersionRect, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER); \
  SelectObject((dc), hpPreviousFont); \
} while (false)

}  // namespace hp
