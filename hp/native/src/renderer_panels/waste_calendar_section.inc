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

struct Course36ClockWasteNotice {
  Course36WasteKind kind = Course36WasteKind::None;
  SYSTEMTIME date{};
  bool hasDate = false;
};

constexpr std::array<Course36WasteKind, 3> kCourse36ClockWasteKinds{{
    Course36WasteKind::BottlesCansPet,
    Course36WasteKind::NonBurnableHazardous,
    Course36WasteKind::Paper,
}};

const std::array<Course36ClockWasteNotice, 3>& Course36ClockWasteNotices(
    const SYSTEMTIME& now) {
  struct Cache {
    WORD year = 0xFFFF;
    WORD month = 0;
    WORD day = 0;
    std::array<Course36ClockWasteNotice, 3> notices{};
  };
  static Cache cache;
  if (cache.year == now.wYear && cache.month == now.wMonth &&
      cache.day == now.wDay) {
    return cache.notices;
  }

  cache.year = now.wYear;
  cache.month = now.wMonth;
  cache.day = now.wDay;
  cache.notices = {};

  std::array<bool, 3> found{};
  size_t foundCount = 0;
  constexpr int kSearchDays = 62;
  for (int offset = 0; offset <= kSearchDays && foundCount < 3; ++offset) {
    SYSTEMTIME date{};
    if (!Course36AddDays(now, offset, date)) break;
    const Course36WasteKind kind = Course36WasteForDate(date);

    size_t kindIndex = kCourse36ClockWasteKinds.size();
    for (size_t index = 0; index < kCourse36ClockWasteKinds.size(); ++index) {
      if (kCourse36ClockWasteKinds[index] == kind) {
        kindIndex = index;
        break;
      }
    }
    if (kindIndex >= found.size() || found[kindIndex]) continue;

    found[kindIndex] = true;
    cache.notices[foundCount++] = Course36ClockWasteNotice{kind, date, true};
  }

  // Keep the strip at three entries even when the published calendar no longer
  // contains a future date for one or more categories.
  for (size_t index = 0; index < kCourse36ClockWasteKinds.size(); ++index) {
    if (found[index] || foundCount >= cache.notices.size()) continue;
    cache.notices.at(foundCount++).kind = kCourse36ClockWasteKinds[index];
  }
  return cache.notices;
}

std::wstring Course36ClockWasteDateText(const Course36ClockWasteNotice& notice) {
  if (!notice.hasDate) return L"--/--";
  wchar_t text[16]{};
  swprintf_s(text, L"%u/%u", static_cast<unsigned>(notice.date.wMonth),
             static_cast<unsigned>(notice.date.wDay));
  return text;
}

const wchar_t* Course36ClockWasteKindText(Course36WasteKind kind) {
  switch (kind) {
    case Course36WasteKind::BottlesCansPet: return L"ビン・缶";
    case Course36WasteKind::NonBurnableHazardous: return L"不燃・有害";
    case Course36WasteKind::Paper: return L"紙類";
    default: return L"";
  }
}

void DrawCourse36ClockWasteNotices(
    HDC dc, const SYSTEMTIME& now, const RECT& rect) {
  if (!dc || rect.right <= rect.left || rect.bottom <= rect.top) return;
  const auto& notices = Course36ClockWasteNotices(now);
  const int width = std::max(1L, rect.right - rect.left);
  const int height = std::max(1L, rect.bottom - rect.top);
  const int gap = std::max(2, width * 12 / 1000);
  const int availableWidth = std::max(3, width - gap * 2);
  const int baseCellWidth = availableWidth / 3;
  const int contentGap = std::max(2, width * 8 / 1000);
  const int fontHeight = std::clamp(height * 30 / 100, 10, 15);

  HGDIOBJ previousFont = SelectObject(
      dc, CachedUiFont(fontHeight, FW_SEMIBOLD));
  SetTextColor(dc, kWidgetText);

  for (size_t index = 0; index < notices.size(); ++index) {
    const LONG cellLeft = rect.left +
        static_cast<LONG>(index) * (baseCellWidth + gap);
    const LONG cellRight = index + 1 == notices.size()
        ? rect.right
        : cellLeft + baseCellWidth;
    const int cellWidth = std::max(1L, cellRight - cellLeft);
    const int dateWidth = std::clamp(cellWidth * 36 / 100, 30, 52);
    RECT dateRect{cellLeft, rect.top, cellLeft + dateWidth, rect.bottom};
    DrawTextInRect(dc, Course36ClockWasteDateText(notices[index]), dateRect,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER);

    RECT kindRect{
        std::min<LONG>(cellRight, dateRect.right + contentGap),
        rect.top,
        cellRight,
        rect.bottom,
    };
    DrawTextInRect(dc, Course36ClockWasteKindText(notices[index].kind), kindRect,
                   DT_CENTER | DT_SINGLELINE | DT_VCENTER | DT_END_ELLIPSIS);
  }

  SelectObject(dc, previousFont);
}

}  // namespace
