namespace {

enum class Course36WasteKind {
  None,
  OutsidePublishedPeriod,
  Combustible,
  PlasticContainers,
  BottlesCansPet,
  NonBurnableHazardous,
  Cloth,
  Paper,
};

struct Course36MonthSchedule {
  WORD year = 0;
  WORD month = 0;
  std::array<WORD, 3> bottlesCansPet{};
  size_t bottlesCansPetCount = 0;
  WORD nonBurnableHazardous = 0;
  std::array<WORD, 2> cloth{};
  size_t clothCount = 0;
  WORD paper = 0;
};

// Kawagoe collection course 36, Reiwa 8 fiscal-year schedule
// (2026-04-01 through 2027-03-31), transcribed from the city's calendar.
constexpr std::array<Course36MonthSchedule, 12> kCourse36Schedule{{
    {2026, 4, {2, 16, 0}, 2, 23, {9, 0}, 1, 27},
    {2026, 5, {7, 21, 0}, 2, 28, {14, 0}, 1, 25},
    {2026, 6, {4, 18, 0}, 2, 25, {11, 0}, 1, 22},
    {2026, 7, {2, 16, 30}, 3, 23, {9, 0}, 1, 27},
    {2026, 8, {13, 27, 0}, 2, 20, {6, 0}, 1, 24},
    {2026, 9, {10, 24, 0}, 2, 17, {3, 0}, 1, 28},
    {2026, 10, {8, 22, 0}, 2, 15, {1, 29}, 2, 26},
    {2026, 11, {5, 19, 0}, 2, 12, {26, 0}, 1, 23},
    {2026, 12, {3, 17, 0}, 2, 10, {24, 0}, 1, 28},
    {2027, 1, {7, 21, 0}, 2, 14, {28, 0}, 1, 25},
    {2027, 2, {11, 25, 0}, 2, 18, {0, 0}, 0, 22},
    {2027, 3, {11, 25, 0}, 2, 18, {4, 0}, 1, 22},
}};

int Course36DateKey(const SYSTEMTIME& date) {
  return static_cast<int>(date.wYear) * 10'000 +
      static_cast<int>(date.wMonth) * 100 + static_cast<int>(date.wDay);
}

const Course36MonthSchedule* Course36ScheduleFor(const SYSTEMTIME& date) {
  for (const auto& month : kCourse36Schedule) {
    if (month.year == date.wYear && month.month == date.wMonth) return &month;
  }
  return nullptr;
}

template <size_t Size>
bool Course36ContainsDay(const std::array<WORD, Size>& days, size_t count, WORD day) {
  const size_t boundedCount = std::min(count, days.size());
  return std::find(days.begin(), days.begin() + boundedCount, day) !=
      days.begin() + boundedCount;
}

Course36WasteKind Course36WasteForDate(const SYSTEMTIME& date) {
  const int dateKey = Course36DateKey(date);
  if (dateKey < 20260401 || dateKey > 20270331) {
    return Course36WasteKind::OutsidePublishedPeriod;
  }

  // Combustible waste is collected every Tuesday and Friday, including holidays.
  // The published year-end exception makes 2027-01-01 a non-collection day.
  if (date.wDayOfWeek == 2 || date.wDayOfWeek == 5) {
    return dateKey == 20270101
        ? Course36WasteKind::None
        : Course36WasteKind::Combustible;
  }

  // Plastic containers and wrapping are collected every Wednesday, including
  // holidays, except the published 2026-12-30 year-end suspension.
  if (date.wDayOfWeek == 3) {
    return dateKey == 20261230
        ? Course36WasteKind::None
        : Course36WasteKind::PlasticContainers;
  }

  const Course36MonthSchedule* month = Course36ScheduleFor(date);
  if (!month) return Course36WasteKind::None;
  if (Course36ContainsDay(
          month->bottlesCansPet, month->bottlesCansPetCount, date.wDay)) {
    return Course36WasteKind::BottlesCansPet;
  }
  if (month->nonBurnableHazardous == date.wDay) {
    return Course36WasteKind::NonBurnableHazardous;
  }
  if (Course36ContainsDay(month->cloth, month->clothCount, date.wDay)) {
    return Course36WasteKind::Cloth;
  }
  if (month->paper == date.wDay) return Course36WasteKind::Paper;
  return Course36WasteKind::None;
}

bool Course36AddDays(const SYSTEMTIME& source, int days, SYSTEMTIME& result) {
  SYSTEMTIME normalized = source;
  normalized.wHour = 12;
  normalized.wMinute = 0;
  normalized.wSecond = 0;
  normalized.wMilliseconds = 0;
  FILETIME fileTime{};
  if (!SystemTimeToFileTime(&normalized, &fileTime)) return false;
  ULARGE_INTEGER value{};
  value.LowPart = fileTime.dwLowDateTime;
  value.HighPart = fileTime.dwHighDateTime;
  constexpr LONGLONG kTicksPerDay = 24LL * 60 * 60 * 10'000'000;
  const LONGLONG next = static_cast<LONGLONG>(value.QuadPart) +
      static_cast<LONGLONG>(days) * kTicksPerDay;
  if (next < 0) return false;
  value.QuadPart = static_cast<ULONGLONG>(next);
  fileTime.dwLowDateTime = value.LowPart;
  fileTime.dwHighDateTime = value.HighPart;
  return FileTimeToSystemTime(&fileTime, &result) != FALSE;
}

const wchar_t* Course36WasteLabel(Course36WasteKind kind) {
  switch (kind) {
    case Course36WasteKind::Combustible: return L"可燃";
    case Course36WasteKind::PlasticContainers: return L"プラ";
    case Course36WasteKind::BottlesCansPet: return L"びん缶\nPET";
    case Course36WasteKind::NonBurnableHazardous: return L"不燃\n有害";
    case Course36WasteKind::Cloth: return L"布類";
    case Course36WasteKind::Paper: return L"紙類";
    case Course36WasteKind::OutsidePublishedPeriod: return L"年度外";
    case Course36WasteKind::None:
    default: return L"なし";
  }
}

void DrawCourse36WasteCalendarOverlay(HDC dc, const RECT& bounds) {
  const int width = std::max(1, static_cast<int>(bounds.right - bounds.left));
  const int height = std::max(1, static_cast<int>(bounds.bottom - bounds.top));
  const int margin = std::max(10, SpanY(bounds, 25));
  const int availableWidth = width - margin * 2;
  const int availableHeight = height - margin * 2;
  if (availableWidth < 140 || availableHeight < 70) return;

  const int minPanelWidth = std::min(220, availableWidth);
  const int panelWidth = std::clamp(width * 36 / 100, minPanelWidth, availableWidth);
  const int minPanelHeight = std::min(90, availableHeight);
  const int panelHeight = std::clamp(height * 18 / 100, minPanelHeight, availableHeight);
  const RECT panel{
      bounds.right - margin - panelWidth,
      bounds.top + margin,
      bounds.right - margin,
      bounds.top + margin + panelHeight,
  };
  const int radius = std::clamp(panelHeight / 9, 8, 14);
  FillRoundRectTranslucent(dc, panel, RGB(8, 10, 14), radius, 190);
  DrawCardOutline(dc, panel, radius);

  const int horizontalPad = std::max(6, panelWidth / 55);
  const int verticalPad = std::max(3, panelHeight / 26);
  const int headerHeight = std::clamp(panelHeight * 25 / 100, 21, 30);
  RECT header{
      panel.left + horizontalPad,
      panel.top + verticalPad,
      panel.right - horizontalPad,
      panel.top + headerHeight,
  };
  HGDIOBJ previousFont = SelectObject(
      dc, CachedUiFont(std::clamp(panelHeight * 125 / 1000, 10, 15), FW_SEMIBOLD));
  SetTextColor(dc, kWidgetText);
  DrawTextInRect(dc, L"ごみ収集  コース36", header,
                 DT_LEFT | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

  RECT grid{
      panel.left + horizontalPad,
      header.bottom + std::max(1, verticalPad / 2),
      panel.right - horizontalPad,
      panel.bottom - verticalPad,
  };
  if (grid.right <= grid.left || grid.bottom <= grid.top) {
    SelectObject(dc, previousFont);
    return;
  }

  SYSTEMTIME now{};
  GetLocalTime(&now);
  static constexpr const wchar_t* kWeekdays[] = {
      L"日", L"月", L"火", L"水", L"木", L"金", L"土"};
  static constexpr const wchar_t* kDayLabels[] = {L"今日", L"明日"};

  const int gridWidth = static_cast<int>(grid.right - grid.left);
  const int gridHeight = static_cast<int>(grid.bottom - grid.top);
  const int cellGap = std::max(2, panelWidth / 90);
  for (int index = 0; index < 2; ++index) {
    SYSTEMTIME date{};
    if (!Course36AddDays(now, index, date)) continue;
    const int cellLeft = grid.left + gridWidth * index / 2;
    const int cellRight = grid.left + gridWidth * (index + 1) / 2;
    RECT cell{
        cellLeft + (index == 0 ? 0 : cellGap),
        grid.top,
        cellRight - (index == 1 ? 0 : cellGap),
        grid.bottom,
    };
    if (cell.right <= cell.left || cell.bottom <= cell.top) continue;

    FillRoundRectTranslucent(
        dc, cell, RGB(255, 255, 255), std::max(5, gridHeight / 8), index == 0 ? 62 : 24);

    const int dateHeight = std::clamp(gridHeight * 42 / 100, 18, std::max(18, gridHeight));
    RECT dateRect{cell.left, cell.top, cell.right,
                  std::min(cell.bottom, cell.top + dateHeight)};
    wchar_t dateText[28]{};
    swprintf_s(dateText, L"%s %s %u/%u", kDayLabels[index],
               kWeekdays[date.wDayOfWeek % 7], date.wMonth, date.wDay);
    SelectObject(dc, CachedUiFont(std::clamp(panelHeight * 112 / 1000, 10, 14), FW_SEMIBOLD));
    SetTextColor(dc, index == 0 ? kWidgetText : kWidgetMuted);
    DrawTextInRect(dc, dateText, dateRect,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);

    RECT kindRect{cell.left + 1, dateRect.bottom, cell.right - 1, cell.bottom};
    SelectObject(dc, CachedUiFont(std::clamp(panelHeight * 130 / 1000, 11, 16), FW_SEMIBOLD));
    SetTextColor(dc, kWidgetText);
    DrawTextInRect(dc, Course36WasteLabel(Course36WasteForDate(date)), kindRect,
                   DT_CENTER | DT_VCENTER | DT_WORDBREAK);
  }
  SelectObject(dc, previousFont);
}

void DrawCardOutlineWithWasteCalendarOverlay(HDC dc, const RECT& bounds, int radius) {
  DrawCourse36WasteCalendarOverlay(dc, bounds);
  DrawCardOutline(dc, bounds, radius);
}

}  // namespace
