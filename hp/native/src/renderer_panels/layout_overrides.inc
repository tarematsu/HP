namespace {

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
  // The waste summary now lives below the clock. Keep the rain radar filling
  // the complete left column that previously also hosted the waste calendar.
  layout.sections.music =
      RECT{client.left, client.top, client.left + leftWidth, client.bottom};
  // MainSections::air is the right-hand slot. The rearranged dashboard uses it
  // for Electricity while Air occupies the expanded side-card slot.
  layout.sections.air =
      RECT{layout.sections.music.right + gapX, client.top, client.right, client.bottom};
  if (layout.sections.music.right <= layout.sections.music.left) {
    layout.sections.music.right = layout.sections.music.left + 1;
  }
  if (layout.sections.music.bottom <= layout.sections.music.top) {
    layout.sections.music.bottom = layout.sections.music.top + 1;
  }
  if (layout.sections.air.right <= layout.sections.air.left) {
    layout.sections.air.right = layout.sections.air.left + 1;
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
  SYSTEMTIME hpNow{}; GetLocalTime(&hpNow); \
  RECT hpDateRect{hpClockContent.left, hpClockContent.top, hpClockContent.right, hpClockContent.top + SpanY(hpClockContent, 170)}; \
  RECT hpTimeRect{hpClockContent.left, hpDateRect.bottom, hpClockContent.right, hpClockContent.top + SpanY(hpClockContent, 650)}; \
  RECT hpWasteRect{hpClockContent.left, hpTimeRect.bottom, hpClockContent.right, hpClockContent.top + SpanY(hpClockContent, 780)}; \
  RECT hpStatusRect{hpClockContent.left, hpClockContent.top + SpanY(hpClockContent, 790), hpClockContent.right, hpClockContent.bottom}; \
  HGDIOBJ hpPreviousFont = SelectObject((dc), TierFont(FontTier::Medium)); \
  SetTextColor((dc), kWidgetMuted); \
  DrawTextInRect((dc), DateText(hpNow), hpDateRect, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER); \
  const int hpTimeHeight = std::max(1L, hpTimeRect.bottom - hpTimeRect.top); \
  const int hpTimeWidth = std::max(1L, hpTimeRect.right - hpTimeRect.left); \
  const int hpTimeFontHeight = std::clamp(std::min(hpTimeHeight * 72 / 100, hpTimeWidth * 18 / 100), 32, 88); \
  SelectObject((dc), CachedUiFont(hpTimeFontHeight, FW_SEMIBOLD)); \
  SetTextColor((dc), kWidgetText); \
  DrawFixedWidthClockTime((dc), TimeText(hpNow), hpTimeRect); \
  const std::wstring& hpWasteText = Course36ClockWasteSummary(hpNow); \
  SelectObject((dc), TierFont(FontTier::Medium)); \
  SetTextColor((dc), kWidgetText); \
  DrawTextInRect((dc), hpWasteText, hpWasteRect, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER); \
  std::wstring hpVersionText = L"アプリバージョン "; \
  hpVersionText += kVersion; \
  const int hpControlButtonWidth = std::clamp(SpanX(hpStatusRect, 300), 86, 150); \
  const int hpControlButtonGap = std::max(6, SpanX(hpStatusRect, 20)); \
  const LONG hpStatusTextRight = std::max<LONG>(hpStatusRect.left + 1, hpStatusRect.right - hpControlButtonWidth - hpControlButtonGap); \
  RECT hpVersionRect = hpStatusRect; hpVersionRect.right = hpStatusTextRight; \
  SelectObject((dc), TierFont(FontTier::Small)); \
  SetTextColor((dc), kWidgetMuted); \
  DrawTextInRect((dc), hpVersionText, hpVersionRect, DT_CENTER | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER); \
  SelectObject((dc), hpPreviousFont); \
} while (false)

}  // namespace hp
