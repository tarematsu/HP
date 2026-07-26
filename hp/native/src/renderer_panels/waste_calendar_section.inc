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

struct Course36WasteVisual {
  const wchar_t* firstLine = L"";
  const wchar_t* secondLine = L"";
  COLORREF surface = kWidgetSurfaceAlt;
  COLORREF text = kWidgetMuted;
};

Course36WasteVisual Course36VisualFor(Course36WasteKind kind) {
  switch (kind) {
    case Course36WasteKind::Combustible:
      return {L"可燃ごみ", L"", kWidgetDangerSurface, kWidgetDanger};
    case Course36WasteKind::PlasticContainers:
      return {L"プラ製容器", L"包装", RGB(22, 48, 55), kWidgetCyan};
    case Course36WasteKind::BottlesCansPet:
      return {L"びん・かん", L"ペットボトル", RGB(28, 43, 61), kWidgetBlueMuted};
    case Course36WasteKind::NonBurnableHazardous:
      return {L"不燃・有害", L"", RGB(56, 49, 23), kWidgetWarning};
    case Course36WasteKind::Cloth:
      return {L"布類", L"", kWidgetSuccessSurface, kWidgetGreen};
    case Course36WasteKind::Paper:
      return {L"紙類", L"", RGB(58, 42, 25), kWidgetOrange};
    case Course36WasteKind::OutsidePublishedPeriod:
      return {L"年度外", L"", kWidgetSurfaceAlt, kWidgetSubtle};
    case Course36WasteKind::None:
    default:
      return {L"回収なし", L"", kWidgetSurfaceAlt, kWidgetSubtle};
  }
}

void DrawCourse36WasteCalendar(HDC dc, const RECT& card) {
  DrawSectionCard(dc, card);
  const RECT content = CardContentRect(card);
  const int contentHeight = std::max(1L, content.bottom - content.top);
  const int headerHeight = std::clamp(contentHeight * 19 / 100, 22, 34);
  const int headerGap = std::max(3, contentHeight * 3 / 100);
  RECT titleRect{content.left, content.top, content.right, content.top + headerHeight};

  HGDIOBJ previousFont = SelectObject(
      dc, CachedUiFont(std::clamp(headerHeight * 45 / 100, 10, 15), FW_NORMAL));
  SetTextColor(dc, kWidgetText);
  DrawTextInRect(dc, L"ごみ収集カレンダー", titleRect,
                 DT_LEFT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER);
  SetTextColor(dc, kWidgetMuted);
  DrawTextInRect(dc, L"収集コース36・令和8年度", titleRect,
                 DT_RIGHT | DT_SINGLELINE | DT_END_ELLIPSIS | DT_VCENTER);

  RECT grid{content.left, titleRect.bottom + headerGap, content.right, content.bottom};
  const int gridWidth = std::max(7L, grid.right - grid.left);
  const int cellGap = std::max(3, gridWidth * 5 / 1000);
  const int availableWidth = std::max(7, gridWidth - cellGap * 6);
  const int cellWidth = std::max(1, availableWidth / 7);
  const int cellHeight = std::max(1L, grid.bottom - grid.top);
  const int cellRadius = std::clamp(cellHeight * 10 / 100, 6, 14);

  SYSTEMTIME today{};
  GetLocalTime(&today);
  SYSTEMTIME weekStart{};
  if (!Course36AddDays(today, -static_cast<int>(today.wDayOfWeek), weekStart)) {
    SelectObject(dc, previousFont);
    return;
  }

  static constexpr const wchar_t* kWeekdays[] =
      {L"日", L"月", L"火", L"水", L"木", L"金", L"土"};
  const int todayKey = Course36DateKey(today);
  for (int index = 0; index < 7; ++index) {
    SYSTEMTIME date{};
    if (!Course36AddDays(weekStart, index, date)) continue;
    const int left = grid.left + index * (cellWidth + cellGap);
    const int right = index == 6 ? grid.right : left + cellWidth;
    const RECT cell{left, grid.top, std::max(left + 1, right), grid.bottom};
    const bool isToday = Course36DateKey(date) == todayKey;

    DrawWidgetCard(dc, cell, isToday ? RGB(27, 39, 55) : kWidgetSurfaceAlt, cellRadius);
    HGDIOBJ previousPen = SelectObject(
        dc, CachedSolidPen(isToday ? 2 : 1,
                          isToday ? kWidgetBlueMuted : kWidgetOutline));
    HGDIOBJ previousBrush = SelectObject(dc, GetStockObject(NULL_BRUSH));
    RoundRect(dc, cell.left, cell.top, cell.right, cell.bottom, cellRadius, cellRadius);
    SelectObject(dc, previousBrush);
    SelectObject(dc, previousPen);

    const int inset = std::max(3, cellWidth * 5 / 100);
    RECT inner = NormalizeInsetRect(cell, inset, inset, inset, inset);
    const int dayHeight = std::clamp(cellHeight * 38 / 100, 30, 58);
    RECT dayRect{inner.left, inner.top, inner.right,
                 std::min(inner.bottom, inner.top + dayHeight)};
    wchar_t dateText[32]{};
    swprintf_s(dateText, L"%s%s\n%u/%u",
               kWeekdays[date.wDayOfWeek % 7], isToday ? L"・今日" : L"",
               date.wMonth, date.wDay);
    SelectObject(dc, CachedUiFont(std::clamp(dayHeight * 29 / 100, 11, 17), FW_SEMIBOLD));
    SetTextColor(dc, date.wDayOfWeek == 0 ? kWidgetDanger
                     : date.wDayOfWeek == 6 ? kWidgetBlueMuted
                     : kWidgetText);
    DrawTextInRect(dc, dateText, dayRect,
                   DT_CENTER | DT_WORDBREAK | DT_VCENTER | DT_END_ELLIPSIS);

    RECT itemRect{inner.left, dayRect.bottom + std::max(2, cellHeight * 2 / 100),
                  inner.right, inner.bottom};
    if (itemRect.bottom <= itemRect.top) itemRect.bottom = itemRect.top + 1;
    const Course36WasteVisual visual = Course36VisualFor(Course36WasteForDate(date));
    DrawWidgetCard(dc, itemRect, visual.surface, std::max(5, cellRadius - 2));
    SelectObject(dc, CachedUiFont(std::clamp(cellHeight * 14 / 100, 14, 22), FW_SEMIBOLD));
    SetTextColor(dc, visual.text);
    std::wstring label = visual.firstLine;
    if (visual.secondLine && *visual.secondLine) {
      label += L"\n";
      label += visual.secondLine;
    }
    DrawTextInRect(dc, label, itemRect,
                   DT_CENTER | DT_WORDBREAK | DT_VCENTER | DT_END_ELLIPSIS);
  }

  SelectObject(dc, previousFont);
}

}  // namespace
