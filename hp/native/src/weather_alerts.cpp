#include "weather_alerts.h"
#include "winhttp_helpers.h"

#include <limits>
#include <set>

namespace hp {
namespace {
using winrt::Windows::Data::Json::IJsonValue;
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

constexpr wchar_t kAlertWindowClass[] = L"HomePanelWeatherAlertWindow";
constexpr wchar_t kEewHistoryUrl[] =
    L"https://api.p2pquake.net/v2/history?codes=556&limit=1";
constexpr wchar_t kJmaTyphoonTargetsUrl[] =
    L"https://www.jma.go.jp/bosai/typhoon/data/targetTc.json";
constexpr UINT kWeatherAlertChangedMessage = WM_APP + 0x351;
constexpr int kEmergencyWindowId = 9101;
constexpr int kTyphoonWindowId = 9102;
constexpr int64_t kEewPollMs = 1'250;
constexpr int64_t kEewMaximumAgeMs = 3 * 60'000;
constexpr int64_t kEewDisplayMs = 2 * 60'000;
constexpr int64_t kTyphoonRefreshMs = 10 * 60'000;
constexpr int64_t kTyphoonRetryMs = 2 * 60'000;
constexpr double kKantoRelevantDistanceKm = 500.0;
constexpr double kPi = 3.14159265358979323846;

struct ScopedComApartment {
  HRESULT result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  ~ScopedComApartment() {
    if (SUCCEEDED(result)) CoUninitialize();
  }
};

struct EewAlertState {
  bool active = false;
  std::wstring eventId;
  std::wstring headline;
  std::wstring hypocenter;
  std::wstring magnitude;
  std::wstring maxIntensity;
  std::wstring areas;
  int64_t expiresAt = 0;
};

struct TyphoonAlertState {
  bool active = false;
  std::wstring text;
  double closestDistanceKm = std::numeric_limits<double>::infinity();
  int64_t fetchedAt = 0;
};

struct TyphoonCandidate {
  std::wstring text;
  double closestDistanceKm = std::numeric_limits<double>::infinity();
};

std::optional<JsonObject> ObjectField(const JsonObject& object, const wchar_t* name) {
  const IJsonValue value = object.TryLookup(name);
  if (!value || value.ValueType() != JsonValueType::Object) return std::nullopt;
  return value.GetObject();
}

std::optional<JsonArray> ArrayField(const JsonObject& object, const wchar_t* name) {
  const IJsonValue value = object.TryLookup(name);
  if (!value || value.ValueType() != JsonValueType::Array) return std::nullopt;
  return value.GetArray();
}

std::wstring StringField(const JsonObject& object, const wchar_t* name) {
  const IJsonValue value = object.TryLookup(name);
  if (!value || value.ValueType() != JsonValueType::String) return {};
  return std::wstring(value.GetString().c_str());
}

double NumberField(const JsonObject& object, const wchar_t* name, double fallback) {
  const IJsonValue value = object.TryLookup(name);
  if (!value) return fallback;
  if (value.ValueType() == JsonValueType::Number) return value.GetNumber();
  if (value.ValueType() == JsonValueType::String) {
    const std::wstring text(value.GetString().c_str());
    wchar_t* end = nullptr;
    const double parsed = wcstod(text.c_str(), &end);
    if (end && end != text.c_str() && *end == L'\0') return parsed;
  }
  return fallback;
}

bool BoolField(const JsonObject& object, const wchar_t* name, bool fallback) {
  const IJsonValue value = object.TryLookup(name);
  if (!value || value.ValueType() != JsonValueType::Boolean) return fallback;
  return value.GetBoolean();
}

std::wstring ScalarTextField(const JsonObject& object, const wchar_t* name) {
  const IJsonValue value = object.TryLookup(name);
  if (!value) return {};
  if (value.ValueType() == JsonValueType::String) {
    return std::wstring(value.GetString().c_str());
  }
  if (value.ValueType() == JsonValueType::Number) {
    const double number = value.GetNumber();
    wchar_t text[64]{};
    if (std::abs(number - std::round(number)) < 0.0001) {
      swprintf_s(text, L"%.0f", number);
    } else {
      swprintf_s(text, L"%.1f", number);
    }
    return text;
  }
  return {};
}

bool DownloadJsonArray(const std::wstring& url, size_t maximumBytes, JsonArray* output) {
  if (!output) return false;
  std::vector<uint8_t> body;
  if (!WinHttpDownload(url, maximumBytes, &body, nullptr, nullptr,
                       L"HomePanel/2.2 weather-alerts")) {
    return false;
  }
  try {
    const std::string utf8(body.begin(), body.end());
    *output = JsonArray::Parse(winrt::to_hstring(utf8));
    return true;
  } catch (...) {
    return false;
  }
}

int64_t ParseJstMillis(const std::wstring& text) {
  int year = 0;
  int month = 0;
  int day = 0;
  int hour = 0;
  int minute = 0;
  int second = 0;
  if (swscanf_s(text.c_str(), L"%d/%d/%d %d:%d:%d",
                &year, &month, &day, &hour, &minute, &second) != 6) {
    return 0;
  }
  SYSTEMTIME systemTime{};
  systemTime.wYear = static_cast<WORD>(year);
  systemTime.wMonth = static_cast<WORD>(month);
  systemTime.wDay = static_cast<WORD>(day);
  systemTime.wHour = static_cast<WORD>(hour);
  systemTime.wMinute = static_cast<WORD>(minute);
  systemTime.wSecond = static_cast<WORD>(second);
  FILETIME fileTime{};
  if (!SystemTimeToFileTime(&systemTime, &fileTime)) return 0;
  ULARGE_INTEGER ticks{};
  ticks.LowPart = fileTime.dwLowDateTime;
  ticks.HighPart = fileTime.dwHighDateTime;
  constexpr uint64_t kWindowsToUnixTicks = 116444736000000000ull;
  if (ticks.QuadPart < kWindowsToUnixTicks) return 0;
  const int64_t utcLikeMillis = static_cast<int64_t>(
      (ticks.QuadPart - kWindowsToUnixTicks) / 10'000ull);
  // P2PQuake issue timestamps are JST without an offset. SystemTimeToFileTime
  // treats the fields as UTC, so subtract JST's fixed +09:00 offset here.
  return utcLikeMillis - 9 * 60 * 60'000ll;
}

std::wstring ScaleText(int scale) {
  switch (scale) {
    case 0: return L"0";
    case 10: return L"1";
    case 20: return L"2";
    case 30: return L"3";
    case 40: return L"4";
    case 45: return L"5弱";
    case 50: return L"5強";
    case 55: return L"6弱";
    case 60: return L"6強";
    case 70: return L"7";
    default: return L"不明";
  }
}

std::wstring MagnitudeText(double magnitude) {
  if (!std::isfinite(magnitude) || magnitude < 0.0) return {};
  wchar_t text[32]{};
  swprintf_s(text, L"%.1f", magnitude);
  return text;
}

std::wstring JoinAreas(const JsonArray& areas, int* bestScaleFrom, int* bestScaleTo) {
  std::set<std::wstring> seen;
  std::vector<std::wstring> names;
  int selectedFrom = -1;
  int selectedTo = -1;
  for (uint32_t index = 0; index < areas.Size(); ++index) {
    const IJsonValue value = areas.GetAt(index);
    if (!value || value.ValueType() != JsonValueType::Object) continue;
    const JsonObject area = value.GetObject();
    std::wstring name = StringField(area, L"pref");
    if (name.empty()) name = StringField(area, L"name");
    if (!name.empty() && seen.insert(name).second) names.push_back(std::move(name));

    const int from = static_cast<int>(std::lround(NumberField(area, L"scaleFrom", -1)));
    const int to = static_cast<int>(std::lround(NumberField(area, L"scaleTo", -1)));
    if (to == 99) {
      if (selectedTo != 99 || from > selectedFrom) {
        selectedFrom = from;
        selectedTo = 99;
      }
    } else if (selectedTo != 99 && to > selectedTo) {
      selectedFrom = from;
      selectedTo = to;
    }
  }
  if (bestScaleFrom) *bestScaleFrom = selectedFrom;
  if (bestScaleTo) *bestScaleTo = selectedTo;

  std::wstring result;
  const size_t visibleCount = std::min<size_t>(names.size(), 10);
  for (size_t index = 0; index < visibleCount; ++index) {
    if (!result.empty()) result += L"・";
    result += names[index];
  }
  if (names.size() > visibleCount) result += L" ほか";
  return result;
}

double DegreesToRadians(double value) {
  return value * kPi / 180.0;
}

double HaversineKm(double latitudeA, double longitudeA,
                   double latitudeB, double longitudeB) {
  constexpr double kEarthRadiusKm = 6371.0088;
  const double dLatitude = DegreesToRadians(latitudeB - latitudeA);
  const double dLongitude = DegreesToRadians(longitudeB - longitudeA);
  const double a = std::pow(std::sin(dLatitude / 2.0), 2.0) +
      std::cos(DegreesToRadians(latitudeA)) *
          std::cos(DegreesToRadians(latitudeB)) *
          std::pow(std::sin(dLongitude / 2.0), 2.0);
  return 2.0 * kEarthRadiusKm * std::asin(std::min(1.0, std::sqrt(a)));
}

double DistanceToKantoKm(double latitude, double longitude) {
  // Prefectural-capital reference points prevent an offshore track near Chiba
  // or Ibaraki from being missed by a single Tokyo-centroid calculation.
  static constexpr std::array<std::pair<double, double>, 7> kKantoPoints{{
      {35.6762, 139.6503},  // Tokyo
      {35.4437, 139.6380},  // Yokohama
      {35.6074, 140.1065},  // Chiba
      {35.8617, 139.6455},  // Saitama
      {36.3418, 140.4468},  // Mito
      {36.5551, 139.8828},  // Utsunomiya
      {36.3895, 139.0634},  // Maebashi
  }};
  double best = std::numeric_limits<double>::infinity();
  for (const auto& [targetLatitude, targetLongitude] : kKantoPoints) {
    best = std::min(best, HaversineKm(latitude, longitude,
                                     targetLatitude, targetLongitude));
  }
  return best;
}

bool IsActiveTyphoonCategory(const std::wstring& category) {
  return category == L"TY" || category == L"STS" || category == L"TS";
}

bool IsSafeTyphoonId(const std::wstring& id) {
  return !id.empty() && std::all_of(id.begin(), id.end(), [](wchar_t character) {
    return (character >= L'A' && character <= L'Z') ||
           (character >= L'a' && character <= L'z') ||
           (character >= L'0' && character <= L'9');
  });
}

std::wstring TyphoonDisplayName(const std::wstring& number,
                                const std::wstring& name) {
  std::wstring label;
  if (number.size() >= 4 &&
      std::all_of(number.begin(), number.end(), [](wchar_t character) {
        return character >= L'0' && character <= L'9';
      })) {
    const std::wstring suffix = number.substr(number.size() - 2);
    const int numeric = _wtoi(suffix.c_str());
    label = L"台風" + std::to_wstring(numeric) + L"号";
  } else {
    label = L"台風";
  }
  if (!name.empty()) label += L" " + name;
  return label;
}

std::optional<TyphoonCandidate> ParseTyphoonSpecification(
    const JsonArray& reports, const std::wstring& targetNumber) {
  std::wstring name;
  double currentDistance = std::numeric_limits<double>::infinity();
  double futureDistance = std::numeric_limits<double>::infinity();
  std::wstring currentLocation;
  std::wstring currentCourse;
  std::wstring currentSpeed;
  std::wstring currentPressure;

  for (uint32_t index = 0; index < reports.Size(); ++index) {
    const IJsonValue value = reports.GetAt(index);
    if (!value || value.ValueType() != JsonValueType::Object) continue;
    const JsonObject report = value.GetObject();
    const IJsonValue partValue = report.TryLookup(L"part");
    if (partValue && partValue.ValueType() == JsonValueType::String &&
        partValue.GetString() == L"title") {
      if (const auto nameObject = ObjectField(report, L"name")) {
        name = StringField(*nameObject, L"jp");
      }
      continue;
    }

    const double advancedHours = NumberField(report, L"advancedHours", -1.0);
    if (advancedHours < 0.0 || advancedHours > 48.0) continue;
    const auto position = ObjectField(report, L"position");
    if (!position) continue;
    const auto degrees = ArrayField(*position, L"deg");
    if (!degrees || degrees->Size() < 2) continue;
    const IJsonValue latitudeValue = degrees->GetAt(0);
    const IJsonValue longitudeValue = degrees->GetAt(1);
    if (!latitudeValue || !longitudeValue ||
        latitudeValue.ValueType() != JsonValueType::Number ||
        longitudeValue.ValueType() != JsonValueType::Number) {
      continue;
    }
    const double distance = DistanceToKantoKm(latitudeValue.GetNumber(),
                                               longitudeValue.GetNumber());
    if (advancedHours < 0.5) {
      currentDistance = distance;
      currentLocation = StringField(report, L"location");
      currentCourse = StringField(report, L"course");
      currentPressure = ScalarTextField(report, L"pressure");
      if (const auto speed = ObjectField(report, L"speed")) {
        currentSpeed = ScalarTextField(*speed, L"km/h");
      }
    } else {
      futureDistance = std::min(futureDistance, distance);
    }
  }

  const double closestDistance = std::min(currentDistance, futureDistance);
  if (!std::isfinite(closestDistance) ||
      closestDistance > kKantoRelevantDistanceKm) {
    return std::nullopt;
  }

  std::wstring status;
  if (currentDistance <= kKantoRelevantDistanceKm) {
    if (std::isfinite(futureDistance) && futureDistance + 30.0 < currentDistance) {
      status = L"関東に接近中";
    } else if (std::isfinite(futureDistance) &&
               futureDistance > currentDistance + 30.0) {
      status = L"関東付近を通過中";
    } else {
      status = L"関東付近";
    }
  } else {
    status = L"関東へ接近見込み";
  }

  std::wstring text = TyphoonDisplayName(targetNumber, name) + L"　" + status;
  if (!currentLocation.empty()) text += L"　" + currentLocation;
  if (!currentPressure.empty()) text += L"　中心気圧 " + currentPressure + L"hPa";
  if (!currentCourse.empty()) {
    text += L"　" + currentCourse;
    if (!currentSpeed.empty()) text += L" " + currentSpeed + L"km/h";
  }
  return TyphoonCandidate{std::move(text), closestDistance};
}

void DrawTextWithFont(HDC dc, const std::wstring& text, RECT rect, int height,
                      int weight, COLORREF color, UINT flags) {
  HFONT font = CreateFontW(-std::max(10, height), 0, 0, 0, weight,
                           FALSE, FALSE, FALSE, DEFAULT_CHARSET,
                           OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                           CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE,
                           L"Yu Gothic UI");
  HGDIOBJ previous = nullptr;
  if (font) previous = SelectObject(dc, font);
  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, color);
  DrawTextW(dc, text.c_str(), -1, &rect, flags | DT_NOPREFIX);
  if (previous) SelectObject(dc, previous);
  if (font) DeleteObject(font);
}

class WeatherAlertRuntime {
 public:
  static WeatherAlertRuntime& Instance() {
    static WeatherAlertRuntime instance;
    return instance;
  }

  void Start(HWND parentWindow, HWND radarWindow) noexcept {
    try {
      parentWindow_ = parentWindow;
      radarWindow_ = radarWindow;
      if (!EnsureWindows()) return;
      RefreshPresentation();
      if (started_.exchange(true, std::memory_order_acq_rel)) return;
      stopping_ = false;
      try {
        eewThread_ = std::thread([this] { EewLoop(); });
        typhoonThread_ = std::thread([this] { TyphoonLoop(); });
      } catch (...) {
        stopping_ = true;
        wake_.notify_all();
        if (eewThread_.joinable()) eewThread_.join();
        if (typhoonThread_.joinable()) typhoonThread_.join();
        started_ = false;
        OutputDebugStringW(L"HomePanel weather alert worker startup failed\n");
      }
    } catch (...) {
      OutputDebugStringW(L"HomePanel weather alert initialization failed\n");
    }
  }

  void Stop() noexcept {
    try {
      if (started_.exchange(false, std::memory_order_acq_rel)) {
        stopping_ = true;
        wake_.notify_all();
        if (eewThread_.joinable()) eewThread_.join();
        if (typhoonThread_.joinable()) typhoonThread_.join();
      }
      {
        std::lock_guard lock(stateMutex_);
        eew_ = {};
        typhoon_ = {};
      }
      if (emergencyWindow_ && IsWindow(emergencyWindow_)) DestroyWindow(emergencyWindow_);
      if (typhoonWindow_ && IsWindow(typhoonWindow_)) DestroyWindow(typhoonWindow_);
      emergencyWindow_ = nullptr;
      typhoonWindow_ = nullptr;
      parentWindow_ = nullptr;
      radarWindow_ = nullptr;
      lastEewMessageKey_.clear();
    } catch (...) {
      OutputDebugStringW(L"HomePanel weather alert shutdown failed\n");
    }
  }

  void RefreshPresentation() noexcept {
    try {
      bool eewActive = false;
      bool typhoonActive = false;
      {
        std::lock_guard lock(stateMutex_);
        eewActive = eew_.active && eew_.expiresAt > UnixMillis();
        typhoonActive = typhoon_.active;
      }

      if (emergencyWindow_ && IsWindow(emergencyWindow_) &&
          parentWindow_ && IsWindow(parentWindow_)) {
        RECT parentBounds{};
        GetClientRect(parentWindow_, &parentBounds);
        SetWindowPos(emergencyWindow_, HWND_TOP,
                     parentBounds.left, parentBounds.top,
                     std::max(1L, parentBounds.right - parentBounds.left),
                     std::max(1L, parentBounds.bottom - parentBounds.top),
                     SWP_NOACTIVATE | SWP_NOSENDCHANGING |
                         (eewActive ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
        if (eewActive) InvalidateRect(emergencyWindow_, nullptr, FALSE);
      }

      if (typhoonWindow_ && IsWindow(typhoonWindow_) &&
          radarWindow_ && IsWindow(radarWindow_)) {
        RECT radarBounds{};
        GetClientRect(radarWindow_, &radarBounds);
        const int radarHeight = std::max(1L, radarBounds.bottom - radarBounds.top);
        const int radarWidth = std::max(1L, radarBounds.right - radarBounds.left);
        const int margin = std::clamp(radarHeight * 18 / 1000, 8, 20);
        const int stripHeight = std::clamp(radarHeight * 115 / 1000, 58, 112);
        const int left = margin;
        const int top = std::max(margin, radarHeight - stripHeight - margin);
        SetWindowPos(typhoonWindow_, HWND_TOP,
                     left, top, std::max(1, radarWidth - margin * 2), stripHeight,
                     SWP_NOACTIVATE | SWP_NOSENDCHANGING |
                         (typhoonActive ? SWP_SHOWWINDOW : SWP_HIDEWINDOW));
        if (typhoonActive) InvalidateRect(typhoonWindow_, nullptr, FALSE);
      }

      // Reassert emergency z-order last because radar/MV children may also be
      // raised while the dashboard layout is being refreshed.
      if (eewActive && emergencyWindow_ && IsWindow(emergencyWindow_)) {
        SetWindowPos(emergencyWindow_, HWND_TOP, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
      }
    } catch (...) {
      OutputDebugStringW(L"HomePanel weather alert layout refresh failed\n");
    }
  }

  LRESULT HandleMessage(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) noexcept {
    try {
      switch (message) {
        case WM_ERASEBKGND:
          return 1;
        case kWeatherAlertChangedMessage:
          RefreshPresentation();
          return 0;
        case WM_PAINT:
          if (GetDlgCtrlID(hwnd) == kEmergencyWindowId) PaintEmergency(hwnd);
          else PaintTyphoon(hwnd);
          return 0;
        case WM_NCHITTEST:
          if (GetDlgCtrlID(hwnd) == kTyphoonWindowId) return HTTRANSPARENT;
          break;
        case WM_LBUTTONDOWN:
        case WM_LBUTTONUP:
          if (GetDlgCtrlID(hwnd) == kEmergencyWindowId) return 0;
          break;
        case WM_NCDESTROY:
          if (hwnd == emergencyWindow_) emergencyWindow_ = nullptr;
          if (hwnd == typhoonWindow_) typhoonWindow_ = nullptr;
          break;
      }
      return DefWindowProcW(hwnd, message, wparam, lparam);
    } catch (...) {
      if (message == WM_PAINT) ValidateRect(hwnd, nullptr);
      return 0;
    }
  }

 private:
  static LRESULT CALLBACK WindowProc(HWND hwnd, UINT message,
                                     WPARAM wparam, LPARAM lparam) {
    return Instance().HandleMessage(hwnd, message, wparam, lparam);
  }

  bool EnsureWindows() {
    if (!parentWindow_ || !IsWindow(parentWindow_) ||
        !radarWindow_ || !IsWindow(radarWindow_)) {
      return false;
    }
    WNDCLASSW windowClass{};
    windowClass.lpfnWndProc = WindowProc;
    windowClass.hInstance = GetModuleHandleW(nullptr);
    windowClass.lpszClassName = kAlertWindowClass;
    windowClass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
    windowClass.hbrBackground = nullptr;
    SetLastError(ERROR_SUCCESS);
    if (!RegisterClassW(&windowClass) &&
        GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
      return false;
    }

    if (!emergencyWindow_ || !IsWindow(emergencyWindow_)) {
      emergencyWindow_ = CreateWindowExW(
          0, kAlertWindowClass, L"HomePanelEmergencyEarthquakeWarning",
          WS_CHILD | WS_CLIPSIBLINGS,
          0, 0, 1, 1, parentWindow_,
          reinterpret_cast<HMENU>(static_cast<INT_PTR>(kEmergencyWindowId)),
          GetModuleHandleW(nullptr), nullptr);
    }
    if (!typhoonWindow_ || !IsWindow(typhoonWindow_)) {
      typhoonWindow_ = CreateWindowExW(
          0, kAlertWindowClass, L"HomePanelKantoTyphoonAlert",
          WS_CHILD | WS_CLIPSIBLINGS,
          0, 0, 1, 1, radarWindow_,
          reinterpret_cast<HMENU>(static_cast<INT_PTR>(kTyphoonWindowId)),
          GetModuleHandleW(nullptr), nullptr);
    }
    return emergencyWindow_ && typhoonWindow_;
  }

  bool WaitForStop(int64_t milliseconds) {
    std::unique_lock lock(wakeMutex_);
    return wake_.wait_for(lock, std::chrono::milliseconds(milliseconds), [this] {
      return stopping_.load(std::memory_order_acquire);
    });
  }

  void NotifyChanged() {
    HWND target = emergencyWindow_ && IsWindow(emergencyWindow_)
        ? emergencyWindow_ : typhoonWindow_;
    if (target && IsWindow(target)) {
      PostMessageW(target, kWeatherAlertChangedMessage, 0, 0);
    }
  }

  void ExpireEewIfNeeded(int64_t now) {
    bool changed = false;
    {
      std::lock_guard lock(stateMutex_);
      if (eew_.active && eew_.expiresAt <= now) {
        eew_ = {};
        changed = true;
      }
    }
    if (changed) NotifyChanged();
  }

  void EewLoop() {
    ScopedComApartment apartment;
    while (!stopping_.load(std::memory_order_acquire)) {
      try {
        PollEew();
      } catch (...) {
        OutputDebugStringW(L"HomePanel EEW poll failed\n");
      }
      ExpireEewIfNeeded(UnixMillis());
      if (WaitForStop(kEewPollMs)) break;
    }
  }

  void PollEew() {
    JsonArray messages;
    if (!DownloadJsonArray(kEewHistoryUrl, 512 * 1024, &messages) ||
        messages.Size() == 0) {
      return;
    }
    const IJsonValue first = messages.GetAt(0);
    if (!first || first.ValueType() != JsonValueType::Object) return;
    const JsonObject message = first.GetObject();
    if (static_cast<int>(std::lround(NumberField(message, L"code", -1))) != 556 ||
        BoolField(message, L"test", false)) {
      return;
    }
    const auto issue = ObjectField(message, L"issue");
    if (!issue) return;
    const std::wstring eventId = StringField(*issue, L"eventId");
    const std::wstring serial = StringField(*issue, L"serial");
    const std::wstring issueText = StringField(*issue, L"time");
    const bool cancelled = BoolField(message, L"cancelled", false);
    const std::wstring messageKey = eventId + L"#" + serial +
        (cancelled ? L"#cancel" : L"#active");
    if (messageKey.empty() || messageKey == lastEewMessageKey_) return;
    lastEewMessageKey_ = messageKey;

    const int64_t now = UnixMillis();
    const int64_t issueAt = ParseJstMillis(issueText);
    if (issueAt <= 0 || now - issueAt > kEewMaximumAgeMs ||
        issueAt - now > 60'000) {
      return;
    }

    if (cancelled) {
      bool changed = false;
      {
        std::lock_guard lock(stateMutex_);
        if (eew_.active && (eventId.empty() || eew_.eventId == eventId)) {
          eew_ = {};
          changed = true;
        }
      }
      if (changed) NotifyChanged();
      return;
    }

    EewAlertState next;
    next.active = true;
    next.eventId = eventId;
    next.expiresAt = std::max(now + 30'000, issueAt + kEewDisplayMs);

    if (const auto earthquake = ObjectField(message, L"earthquake")) {
      if (const auto hypocenter = ObjectField(*earthquake, L"hypocenter")) {
        next.hypocenter = StringField(*hypocenter, L"name");
        next.magnitude = MagnitudeText(NumberField(*hypocenter, L"magnitude", -1.0));
      }
    }
    int bestFrom = -1;
    int bestTo = -1;
    if (const auto areas = ArrayField(message, L"areas")) {
      next.areas = JoinAreas(*areas, &bestFrom, &bestTo);
    }
    if (bestTo == 99) {
      next.maxIntensity = ScaleText(bestFrom) + L"程度以上";
    } else {
      next.maxIntensity = ScaleText(bestTo);
    }
    if (next.maxIntensity == L"不明") next.maxIntensity.clear();
    next.headline = next.hypocenter.empty()
        ? L"強い揺れが予想されています"
        : next.hypocenter + L"を震源とする地震";

    {
      std::lock_guard lock(stateMutex_);
      eew_ = std::move(next);
    }
    NotifyChanged();
  }

  void TyphoonLoop() {
    ScopedComApartment apartment;
    while (!stopping_.load(std::memory_order_acquire)) {
      bool success = false;
      try {
        success = PollTyphoons();
      } catch (...) {
        OutputDebugStringW(L"HomePanel typhoon poll failed\n");
      }
      if (WaitForStop(success ? kTyphoonRefreshMs : kTyphoonRetryMs)) break;
    }
  }

  bool PollTyphoons() {
    JsonArray targets;
    if (!DownloadJsonArray(kJmaTyphoonTargetsUrl, 256 * 1024, &targets)) {
      return false;
    }

    std::vector<TyphoonCandidate> candidates;
    size_t activeTargets = 0;
    size_t successfulSpecifications = 0;
    for (uint32_t index = 0; index < targets.Size(); ++index) {
      const IJsonValue value = targets.GetAt(index);
      if (!value || value.ValueType() != JsonValueType::Object) continue;
      const JsonObject target = value.GetObject();
      const std::wstring category = StringField(target, L"category");
      if (!IsActiveTyphoonCategory(category)) continue;
      const std::wstring id = StringField(target, L"tropicalCyclone");
      const std::wstring number = StringField(target, L"typhoonNumber");
      if (!IsSafeTyphoonId(id)) continue;
      ++activeTargets;

      const std::wstring url =
          L"https://www.jma.go.jp/bosai/typhoon/data/" + id +
          L"/specifications.json";
      JsonArray reports;
      if (!DownloadJsonArray(url, 512 * 1024, &reports)) continue;
      ++successfulSpecifications;
      if (const auto candidate = ParseTyphoonSpecification(reports, number)) {
        candidates.push_back(*candidate);
      }
    }

    // Do not erase a valid alert merely because every per-storm request failed.
    if (activeTargets > 0 && successfulSpecifications == 0) return false;
    if (activeTargets > successfulSpecifications && candidates.empty()) return false;

    std::sort(candidates.begin(), candidates.end(), [](const auto& left, const auto& right) {
      return left.closestDistanceKm < right.closestDistanceKm;
    });

    TyphoonAlertState next;
    if (!candidates.empty()) {
      next.active = true;
      next.text = candidates.front().text;
      next.closestDistanceKm = candidates.front().closestDistanceKm;
      next.fetchedAt = UnixMillis();
    }

    bool changed = false;
    {
      std::lock_guard lock(stateMutex_);
      changed = typhoon_.active != next.active || typhoon_.text != next.text;
      typhoon_ = std::move(next);
    }
    if (changed) NotifyChanged();
    return true;
  }

  void PaintEmergency(HWND hwnd) {
    PAINTSTRUCT paint{};
    HDC dc = BeginPaint(hwnd, &paint);
    if (!dc) return;
    RECT bounds{};
    GetClientRect(hwnd, &bounds);

    EewAlertState state;
    {
      std::lock_guard lock(stateMutex_);
      state = eew_;
    }
    if (!state.active || state.expiresAt <= UnixMillis()) {
      EndPaint(hwnd, &paint);
      return;
    }

    HBRUSH background = CreateSolidBrush(RGB(105, 0, 0));
    FillRect(dc, &bounds, background);
    DeleteObject(background);
    const int width = std::max(1L, bounds.right - bounds.left);
    const int height = std::max(1L, bounds.bottom - bounds.top);

    RECT header{0, 0, width, height * 19 / 100};
    HBRUSH headerBrush = CreateSolidBrush(RGB(255, 214, 10));
    FillRect(dc, &header, headerBrush);
    DeleteObject(headerBrush);
    DrawTextWithFont(dc, L"緊急地震速報", header,
                     std::clamp(height * 92 / 1000, 54, 150), FW_HEAVY,
                     RGB(35, 20, 0), DT_CENTER | DT_SINGLELINE | DT_VCENTER);

    RECT warning{width * 3 / 100, height * 23 / 100,
                 width * 97 / 100, height * 43 / 100};
    DrawTextWithFont(dc, L"強い揺れに警戒", warning,
                     std::clamp(height * 105 / 1000, 62, 175), FW_HEAVY,
                     RGB(255, 255, 255), DT_CENTER | DT_SINGLELINE | DT_VCENTER);

    if (!state.maxIntensity.empty()) {
      RECT intensity{width * 4 / 100, height * 43 / 100,
                     width * 96 / 100, height * 61 / 100};
      DrawTextWithFont(dc, L"予想最大震度 " + state.maxIntensity, intensity,
                       std::clamp(height * 82 / 1000, 50, 135), FW_BOLD,
                       RGB(255, 225, 90), DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    }

    std::wstring sourceLine = L"震源 " +
        (state.hypocenter.empty() ? L"調査中" : state.hypocenter);
    if (!state.magnitude.empty()) sourceLine += L"　M" + state.magnitude;
    RECT source{width * 5 / 100, height * 63 / 100,
                width * 95 / 100, height * 73 / 100};
    DrawTextWithFont(dc, sourceLine, source,
                     std::clamp(height * 43 / 1000, 28, 72), FW_SEMIBOLD,
                     RGB(255, 255, 255), DT_CENTER | DT_SINGLELINE | DT_VCENTER |
                         DT_END_ELLIPSIS);

    if (!state.areas.empty()) {
      RECT areas{width * 7 / 100, height * 75 / 100,
                 width * 93 / 100, height * 88 / 100};
      DrawTextWithFont(dc, L"警報対象　" + state.areas, areas,
                       std::clamp(height * 34 / 1000, 24, 58), FW_SEMIBOLD,
                       RGB(255, 245, 220), DT_CENTER | DT_WORDBREAK | DT_VCENTER);
    }

    RECT footer{width * 2 / 100, height * 92 / 100,
                width * 98 / 100, height * 98 / 100};
    DrawTextWithFont(dc, L"気象庁発表 / P2P地震情報経由（補助表示）", footer,
                     std::clamp(height * 21 / 1000, 16, 34), FW_NORMAL,
                     RGB(235, 205, 205), DT_CENTER | DT_SINGLELINE | DT_VCENTER);
    EndPaint(hwnd, &paint);
  }

  void PaintTyphoon(HWND hwnd) {
    PAINTSTRUCT paint{};
    HDC dc = BeginPaint(hwnd, &paint);
    if (!dc) return;
    RECT bounds{};
    GetClientRect(hwnd, &bounds);

    TyphoonAlertState state;
    {
      std::lock_guard lock(stateMutex_);
      state = typhoon_;
    }
    if (!state.active) {
      EndPaint(hwnd, &paint);
      return;
    }

    HBRUSH background = CreateSolidBrush(RGB(73, 39, 19));
    FillRect(dc, &bounds, background);
    DeleteObject(background);
    HPEN border = CreatePen(PS_SOLID, 2, RGB(255, 159, 10));
    HGDIOBJ previousPen = SelectObject(dc, border);
    HGDIOBJ previousBrush = SelectObject(dc, GetStockObject(HOLLOW_BRUSH));
    Rectangle(dc, bounds.left, bounds.top, bounds.right, bounds.bottom);
    SelectObject(dc, previousBrush);
    SelectObject(dc, previousPen);
    DeleteObject(border);

    const int width = std::max(1L, bounds.right - bounds.left);
    const int height = std::max(1L, bounds.bottom - bounds.top);
    const int labelWidth = std::clamp(width * 155 / 1000, 120, 220);
    RECT label{14, 0, labelWidth, height};
    RECT text{labelWidth + 8, 0, width - 14, height};
    DrawTextWithFont(dc, L"台風情報", label,
                     std::clamp(height * 34 / 100, 19, 34), FW_BOLD,
                     RGB(255, 187, 71), DT_LEFT | DT_SINGLELINE | DT_VCENTER);
    DrawTextWithFont(dc, state.text, text,
                     std::clamp(height * 29 / 100, 17, 30), FW_SEMIBOLD,
                     RGB(255, 248, 235), DT_LEFT | DT_SINGLELINE | DT_VCENTER |
                         DT_END_ELLIPSIS);
    EndPaint(hwnd, &paint);
  }

  std::atomic<bool> started_{false};
  std::atomic<bool> stopping_{false};
  HWND parentWindow_ = nullptr;
  HWND radarWindow_ = nullptr;
  HWND emergencyWindow_ = nullptr;
  HWND typhoonWindow_ = nullptr;
  std::thread eewThread_;
  std::thread typhoonThread_;
  std::condition_variable wake_;
  std::mutex wakeMutex_;
  std::mutex stateMutex_;
  EewAlertState eew_{};
  TyphoonAlertState typhoon_{};
  std::wstring lastEewMessageKey_;
};
}  // namespace

void StartWeatherAlerts(HWND parentWindow, HWND radarWindow) noexcept {
  WeatherAlertRuntime::Instance().Start(parentWindow, radarWindow);
}

void RefreshWeatherAlertLayout() noexcept {
  WeatherAlertRuntime::Instance().RefreshPresentation();
}

void StopWeatherAlerts() noexcept {
  WeatherAlertRuntime::Instance().Stop();
}

}  // namespace hp
