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

int Course36ClockWasteImageIndex(Course36WasteKind kind) {
  switch (kind) {
    case Course36WasteKind::BottlesCansPet: return 0;
    case Course36WasteKind::NonBurnableHazardous: return 1;
    case Course36WasteKind::Paper: return 2;
    default: return -1;
  }
}

constexpr std::array<const wchar_t*, 3> kCourse36ClockWasteImageFiles{{
    L"bottles-cans.png",
    L"nonburnable-hazardous.png",
    L"paper.png",
}};
constexpr int kCourse36ClockWasteImageWidth = 128;
constexpr int kCourse36ClockWasteImageHeight = 96;
constexpr BYTE kCourse36ClockWasteAlphaThreshold = 8;

RECT Course36ClockWasteVisibleBounds(HBITMAP bitmap) {
  const RECT fullBounds{0, 0, kCourse36ClockWasteImageWidth,
                        kCourse36ClockWasteImageHeight};
  BITMAP info{};
  if (!bitmap || GetObjectW(bitmap, sizeof(info), &info) != sizeof(info) ||
      !info.bmBits || info.bmBitsPixel != 32 || info.bmWidth <= 0 ||
      info.bmHeight == 0) {
    return fullBounds;
  }

  const int width = static_cast<int>(info.bmWidth);
  const int height = static_cast<int>(std::abs(info.bmHeight));
  const int stride = static_cast<int>(std::abs(info.bmWidthBytes));
  const BYTE* pixels = static_cast<const BYTE*>(info.bmBits);
  int left = width;
  int top = height;
  int right = 0;
  int bottom = 0;

  for (int y = 0; y < height; ++y) {
    const BYTE* row = pixels + static_cast<size_t>(y) * stride;
    for (int x = 0; x < width; ++x) {
      if (row[x * 4 + 3] <= kCourse36ClockWasteAlphaThreshold) continue;
      left = std::min(left, x);
      top = std::min(top, y);
      right = std::max(right, x + 1);
      bottom = std::max(bottom, y + 1);
    }
  }

  if (left >= right || top >= bottom) return fullBounds;
  constexpr int kPadding = 2;
  return RECT{
      std::max(0, left - kPadding),
      std::max(0, top - kPadding),
      std::min(width, right + kPadding),
      std::min(height, bottom + kPadding),
  };
}

struct Course36ClockWasteImageAsset {
  ~Course36ClockWasteImageAsset() {
    if (bitmap) DeleteObject(bitmap);
  }

  std::mutex mutex;
  HBITMAP bitmap = nullptr;
  RECT visibleBounds{0, 0, kCourse36ClockWasteImageWidth,
                     kCourse36ClockWasteImageHeight};
};

const std::array<std::shared_ptr<Course36ClockWasteImageAsset>, 3>&
Course36ClockWasteImageAssets() {
  static const std::array<std::shared_ptr<Course36ClockWasteImageAsset>, 3> assets{{
      std::make_shared<Course36ClockWasteImageAsset>(),
      std::make_shared<Course36ClockWasteImageAsset>(),
      std::make_shared<Course36ClockWasteImageAsset>(),
  }};
  return assets;
}

HBITMAP Course36ClockWasteImageBitmap(
    Course36WasteKind kind, RECT& visibleBounds) {
  const int index = Course36ClockWasteImageIndex(kind);
  if (index < 0) return nullptr;
  const auto& asset = Course36ClockWasteImageAssets()[static_cast<size_t>(index)];

  std::lock_guard lock(asset->mutex);
  if (!asset->bitmap) {
    wchar_t executableRaw[MAX_PATH * 4]{};
    if (!GetModuleFileNameW(nullptr, executableRaw, _countof(executableRaw))) return nullptr;
    const fs::path imagePath = fs::path(executableRaw).parent_path() / L"ui" /
        L"waste-icons" /
        kCourse36ClockWasteImageFiles[static_cast<size_t>(index)];
    asset->bitmap = DecodeImageFileToBitmap(
        imagePath, kCourse36ClockWasteImageWidth, kCourse36ClockWasteImageHeight);
    if (asset->bitmap) {
      asset->visibleBounds = Course36ClockWasteVisibleBounds(asset->bitmap);
    }
  }

  visibleBounds = asset->visibleBounds;
  return asset->bitmap;
}

void DrawCourse36WasteFallbackPictogram(
    HDC dc, Course36WasteKind kind, const RECT& rect) {
  const int width = std::max(1L, rect.right - rect.left);
  const int height = std::max(1L, rect.bottom - rect.top);
  const int stroke = std::clamp(std::min(width, height) / 12, 1, 3);
  HGDIOBJ previousPen = SelectObject(dc, CachedPen(PS_SOLID, stroke, kWidgetText));
  HGDIOBJ previousBrush = SelectObject(dc, GetStockObject(HOLLOW_BRUSH));

  const int left = rect.left;
  const int top = rect.top;
  const int right = rect.right;
  const int bottom = rect.bottom;
  const int cx = (left + right) / 2;
  const int cy = (top + bottom) / 2;

  switch (kind) {
    case Course36WasteKind::BottlesCansPet: {
      const int bottleLeft = left + width * 14 / 100;
      const int bottleRight = left + width * 46 / 100;
      const int neckInset = std::max(1, (bottleRight - bottleLeft) / 4);
      RECT bottleBody{bottleLeft, top + height * 32 / 100,
                      bottleRight, bottom - height * 8 / 100};
      RoundRect(dc, bottleBody.left, bottleBody.top, bottleBody.right,
                bottleBody.bottom, stroke * 3, stroke * 3);
      Rectangle(dc, bottleLeft + neckInset, top + height * 10 / 100,
                bottleRight - neckInset, bottleBody.top + stroke);
      RECT can{left + width * 58 / 100, top + height * 22 / 100,
               right - width * 10 / 100, bottom - height * 8 / 100};
      RoundRect(dc, can.left, can.top, can.right, can.bottom,
                stroke * 4, stroke * 4);
      MoveToEx(dc, can.left + stroke, can.top + height / 7, nullptr);
      LineTo(dc, can.right - stroke, can.top + height / 7);
      break;
    }
    case Course36WasteKind::NonBurnableHazardous: {
      RECT battery{left + width * 8 / 100, cy - height * 18 / 100,
                   cx - width * 4 / 100, cy + height * 18 / 100};
      Rectangle(dc, battery.left, battery.top, battery.right, battery.bottom);
      const int terminalWidth = std::max(2, width / 14);
      Rectangle(dc, battery.right, cy - terminalWidth,
                battery.right + terminalWidth, cy + terminalWidth);
      RECT bulb{cx + width * 4 / 100, top + height * 8 / 100,
                right - width * 8 / 100, top + height * 62 / 100};
      Ellipse(dc, bulb.left, bulb.top, bulb.right, bulb.bottom);
      const int stemLeft = bulb.left + (bulb.right - bulb.left) * 30 / 100;
      const int stemRight = bulb.right - (bulb.right - bulb.left) * 30 / 100;
      MoveToEx(dc, stemLeft, bulb.bottom, nullptr);
      LineTo(dc, stemLeft, bottom - height * 10 / 100);
      MoveToEx(dc, stemRight, bulb.bottom, nullptr);
      LineTo(dc, stemRight, bottom - height * 10 / 100);
      MoveToEx(dc, stemLeft, bottom - height * 10 / 100, nullptr);
      LineTo(dc, stemRight, bottom - height * 10 / 100);
      break;
    }
    case Course36WasteKind::Paper: {
      const int insetX = width * 12 / 100;
      const int insetY = height * 10 / 100;
      for (int layer = 2; layer >= 0; --layer) {
        const int offset = layer * std::max(1, stroke * 2);
        Rectangle(dc, left + insetX + offset, top + insetY + offset,
                  right - insetX, bottom - insetY);
      }
      const int lineLeft = left + width * 28 / 100;
      const int lineRight = right - width * 20 / 100;
      for (int row = 0; row < 3; ++row) {
        const int y = top + height * (34 + row * 16) / 100;
        MoveToEx(dc, lineLeft, y, nullptr);
        LineTo(dc, lineRight, y);
      }
      break;
    }
    default:
      break;
  }

  SelectObject(dc, previousBrush);
  SelectObject(dc, previousPen);
}

void DrawCourse36WasteBitmap(HDC dc, HBITMAP bitmap, const RECT& source,
                             const RECT& target) {
  if (!dc || !bitmap) return;
  const int sourceWidth = source.right - source.left;
  const int sourceHeight = source.bottom - source.top;
  const int targetWidth = target.right - target.left;
  const int targetHeight = target.bottom - target.top;
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return;
  }

  HDC sourceDc = SourceMemoryDc(dc);
  if (!sourceDc) return;
  HGDIOBJ previousBitmap = SelectObject(sourceDc, bitmap);
  const BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  AlphaBlend(dc, target.left, target.top, targetWidth, targetHeight,
             sourceDc, source.left, source.top, sourceWidth, sourceHeight, blend);
  SelectObject(sourceDc, previousBitmap);
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

    RECT iconArea{
        std::min<LONG>(cellRight, dateRect.right + contentGap),
        rect.top,
        cellRight,
        rect.bottom,
    };
    const int areaWidth = std::max(1L, iconArea.right - iconArea.left);
    const int areaHeight = std::max(1L, iconArea.bottom - iconArea.top);
    const int maxIconWidth = std::max(1, areaWidth * 96 / 100);
    const int maxIconHeight = std::max(1, areaHeight * 94 / 100);

    RECT sourceRect{0, 0, kCourse36ClockWasteImageWidth,
                    kCourse36ClockWasteImageHeight};
    HBITMAP bitmap = Course36ClockWasteImageBitmap(notices[index].kind, sourceRect);
    const int sourceWidth = bitmap
        ? std::max(1L, sourceRect.right - sourceRect.left)
        : 4;
    const int sourceHeight = bitmap
        ? std::max(1L, sourceRect.bottom - sourceRect.top)
        : 3;

    int iconWidth = maxIconWidth;
    int iconHeight = std::max(1, iconWidth * sourceHeight / sourceWidth);
    if (iconHeight > maxIconHeight) {
      iconHeight = maxIconHeight;
      iconWidth = std::max(1, iconHeight * sourceWidth / sourceHeight);
    }
    RECT iconRect{
        iconArea.left + (areaWidth - iconWidth) / 2,
        iconArea.top + (areaHeight - iconHeight) / 2,
        iconArea.left + (areaWidth - iconWidth) / 2 + iconWidth,
        iconArea.top + (areaHeight - iconHeight) / 2 + iconHeight,
    };

    if (bitmap) DrawCourse36WasteBitmap(dc, bitmap, sourceRect, iconRect);
    else DrawCourse36WasteFallbackPictogram(dc, notices[index].kind, iconRect);
  }

  SelectObject(dc, previousFont);
}

}  // namespace