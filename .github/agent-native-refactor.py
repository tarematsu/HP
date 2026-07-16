from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, text: str) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(text, encoding="utf-8", newline="")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one exact match, found {count}")
    return text.replace(old, new)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    updated, count = re.subn(pattern, lambda _: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected one regex match, found {count}")
    return updated


# Build each renderer responsibility as a normal translation unit instead of
# including implementation .cpp files into renderer_core.cpp.
cmake = read("native/CMakeLists.txt")
cmake = re.sub(
    r'(option\(HOMEPANEL_CI_STATIC_ANALYSIS[^\n]*\)\n)(?:\n){2,}',
    r'\1\n',
    cmake,
    count=1,
)
cmake = replace_once(
    cmake,
    '''set(HOMEPANEL_RENDERER_SOURCES
  src/renderer_core.cpp
  src/renderer_panels.cpp
  src/renderer_radar_ui.cpp)''',
    '''set(HOMEPANEL_RENDERER_SOURCES
  src/renderer_lifecycle.cpp
  src/renderer_dashboard.cpp
  src/renderer_panel_state.cpp
  src/renderer_bitmap_cache.cpp
  src/renderer_panels.cpp
  src/renderer_radar_ui.cpp
  src/dashboard_native_playback.cpp
  src/dashboard_native_minute_facts.cpp
  src/dashboard_playback_resolve.cpp
  src/embedded_ui.cpp)''',
    "native/CMakeLists.txt renderer sources",
)
write("native/CMakeLists.txt", cmake)


# Group the three visible dashboard sections under one revision value object.
header = read("native/src/dashboard_data.h")
header = replace_once(
    header,
    '''struct SwitchBotDeviceData {
  std::wstring name;
  std::wstring state;
};

struct DashboardSnapshot {''',
    '''struct SwitchBotDeviceData {
  std::wstring name;
  std::wstring state;
};

struct DashboardSectionRevisions {
  uint64_t weather = 0;
  uint64_t energy = 0;
  uint64_t news = 0;
};

struct DashboardSnapshot {''',
    "dashboard_data.h revision struct",
)
header = replace_once(
    header,
    '''  uint64_t weatherRevision = 0;
  uint64_t newsRevision = 0;
  uint64_t octopusRevision = 0;
  uint64_t switchBotRevision = 0;''',
    '''  DashboardSectionRevisions revisions;''',
    "dashboard_data.h revision fields",
)
write("native/src/dashboard_data.h", header)


data = read("native/src/dashboard_data.cpp")
data = replace_once(
    data,
    '''uint64_t SectionRevision(const JsonObject& object, const std::wstring& cloudError) {
  std::string source = WideToUtf8(std::wstring(object.Stringify().c_str()));
  source.push_back('\\0');
  source += WideToUtf8(cloudError);
  return Fnv1a64(source);
}''',
    '''void AppendRevisionSource(std::string& source, const JsonObject& object) {
  source += WideToUtf8(std::wstring(object.Stringify().c_str()));
  source.push_back('\\0');
}

uint64_t SectionRevision(const JsonObject& object, const std::wstring& cloudError) {
  std::string source;
  AppendRevisionSource(source, object);
  source += WideToUtf8(cloudError);
  return Fnv1a64(source);
}

uint64_t SectionRevision(const JsonObject& first, const JsonObject& second,
                         const std::wstring& cloudError) {
  std::string source;
  AppendRevisionSource(source, first);
  AppendRevisionSource(source, second);
  source += WideToUtf8(cloudError);
  return Fnv1a64(source);
}''',
    "dashboard_data.cpp revision helpers",
)
data = data.replace("next.weatherRevision = SectionRevision(weather, next.cloudError);",
                    "next.revisions.weather = SectionRevision(weather, next.cloudError);")
data = data.replace("next.newsRevision = SectionRevision(news, next.cloudError);",
                    "next.revisions.news = SectionRevision(news, next.cloudError);")
data = data.replace("    next.octopusRevision = SectionRevision(octopus, next.cloudError);\n", "")
data = data.replace(
    "    next.switchBotRevision = SectionRevision(switchbot, next.cloudError);",
    "    next.revisions.energy = SectionRevision(octopus, switchbot, next.cloudError);",
)
write("native/src/dashboard_data.cpp", data)


# Renderer declarations: use responsibility-based names and grouped state.
renderer_h = read("native/src/web_renderer.h")
for old, new in (
    ("ArtworkBitmapCacheEntry", "BitmapCacheEntry"),
    ("NativeBackBuffer", "PanelBackBuffer"),
    ("NativeSectionBitmapCache", "PanelBitmapCache"),
    ("NativeAirGraphProjection", "AirGraphProjection"),
    ("CacheNativeBitmap", "CacheNativeImageBitmap"),
    ("nativeArtworkBitmaps_", "nativeImageBitmaps_"),
    ("nativeArtworkUseCounter_", "nativeImageUseCounter_"),
    ("radarBitmaps_", "nativeRadarBitmaps_"),
    ("radarBitmapUseCounter_", "nativeRadarBitmapUseCounter_"),
):
    renderer_h = renderer_h.replace(old, new)
renderer_h = replace_once(
    renderer_h,
    '''  struct AirGraphProjection {
    std::vector<AirHistorySample> samples;
    int64_t cutoff = 0;
    double co2Min = 0;
    double co2Max = 0;
    double temperatureMin = 0;
    double temperatureMax = 0;
    double humidityMin = 0;
    double humidityMax = 0;
  };

  struct NativePanelPaintScope {''',
    '''  struct AirGraphProjection {
    std::vector<AirHistorySample> samples;
    int64_t cutoff = 0;
    double co2Min = 0;
    double co2Max = 0;
    double temperatureMin = 0;
    double temperatureMax = 0;
    double humidityMin = 0;
    double humidityMax = 0;
  };
  struct DashboardSourceStamp {
    fs::path path;
    std::uintmax_t size = 0;
    fs::file_time_type modifiedAt{};
    bool valid = false;
  };

  struct NativePanelPaintScope {''',
    "web_renderer.h source stamp",
)
renderer_h = replace_once(
    renderer_h,
    '''  HBITMAP NativePanelBackBuffer(HWND hwnd, HDC dc, int width, int height);
  void ReleaseNativePanelBackBuffer(HWND hwnd);''',
    '''  HBITMAP NativePanelBackBuffer(HWND hwnd, HDC dc, int width, int height);
  void ReleaseNativePanelBackBuffer(HWND hwnd);
  void ResetNativeBitmapCaches() noexcept;''',
    "web_renderer.h cache reset declaration",
)
renderer_h = replace_once(
    renderer_h,
    '''  HBITMAP CachedRadarBitmap(const std::wstring& key, const fs::path& path,
                            int width, int height);''',
    '''  HBITMAP CachedRadarBitmap(const std::wstring& key, const fs::path& path,
                            const std::string& fileStamp, int width, int height);''',
    "web_renderer.h radar cache signature",
)
renderer_h = replace_once(
    renderer_h,
    '''  uint64_t nativeRenderedDashboardRevision_ = 0;
  uint64_t nativeRenderedWeatherRevision_ = 0;
  uint64_t nativeRenderedEnergyRevision_ = 0;
  uint64_t nativeRenderedNewsRevision_ = 0;
  uint64_t nativeAirRenderRevision_ = 0;''',
    '''  DashboardSectionRevisions renderedDashboardRevisions_{};
  uint64_t nativeAirRenderRevision_ = 0;''',
    "web_renderer.h rendered revisions",
)
renderer_h = replace_once(
    renderer_h,
    '''  std::string dashboardUtf8_;
  fs::path dashboardSourcePath_;
  std::uintmax_t dashboardSourceSize_ = 0;
  fs::file_time_type dashboardSourceModifiedAt_{};
  bool dashboardSourceStampValid_ = false;
  uint64_t dashboardSourceRevision_ = 0;
  uint64_t dashboardWeatherRevision_ = 0;
  uint64_t dashboardEnergyRevision_ = 0;
  uint64_t dashboardNewsRevision_ = 0;''',
    '''  std::string dashboardUtf8_;
  DashboardSourceStamp dashboardSourceStamp_{};
  DashboardSectionRevisions dashboardRevisions_{};''',
    "web_renderer.h dashboard source state",
)
write("native/src/web_renderer.h", renderer_h)


# Move dashboard loading out of the renderer lifecycle file.
lifecycle = read("native/src/renderer_state.cpp")
lifecycle = sub_once(
    lifecycle,
    r'\nbool Renderer::LoadDashboard\(const fs::path& jsonPath, bool\* changed\) \{.*?\n\}\n\n(?=RECT Renderer::ClientBounds)',
    "\n",
    "renderer_state.cpp LoadDashboard",
)
lifecycle = sub_once(
    lifecycle,
    r'\nvoid Renderer::NotifyRadarUpdated\(\) \{.*?\n\}\n(?=\n\})',
    "",
    "renderer_state.cpp NotifyRadarUpdated",
)
lifecycle = lifecycle.rstrip()
if not lifecycle.endswith("}"):
    raise SystemExit("renderer_state.cpp namespace close missing")
lifecycle = lifecycle[:-1].rstrip() + "\n\n}  // namespace hp\n"
write("native/src/renderer_lifecycle.cpp", lifecycle)
Path("native/src/renderer_state.cpp").unlink()


# Panel drawing helpers: remove dead helpers, improve naming, and keep the
# panel translation unit focused on layout and drawing.
part1_path = "native/src/renderer_panels/part1.inc"
part1 = read(part1_path)
part1 = part1.replace("constexpr size_t kNativeBitmapCacheLimit = 24;\n", "")
part1 = replace_once(
    part1,
    '''void DrawHistoryLine(HDC dc, const std::vector<AirHistorySample>& samples, const RECT& plot,
                     int64_t cutoff, int64_t spanMs, double minValue, double maxValue,
                     COLORREF color, int width,
                     const std::function<double(const AirHistorySample&)>& valueOf) {''',
    '''template <typename ValueOf>
void DrawHistoryLine(HDC dc, const std::vector<AirHistorySample>& samples, const RECT& plot,
                     int64_t cutoff, int64_t spanMs, double minValue, double maxValue,
                     COLORREF color, int width, ValueOf&& valueOf) {''',
    "part1 DrawHistoryLine template",
)
part1 = replace_once(
    part1,
    '''struct SidebarSections {
  RECT clock{};
  RECT air{};
  RECT weather{};
  RECT controls{};
};

SidebarSections SplitSidebarSections(const RECT& client) {
  const int height = std::max(1L, client.bottom - client.top);
  const int gap = std::max(6, height * 18 / 1000);

  // The sidebar and main panel share the same inner dashboard height. Mirror
  // SplitMainSections' radar/news proportions so the controls card lines up
  // with the news card, then split the rest evenly across the clock,
  // weather-forecast, and energy cards so all three share one height.
  const int radarHeight = height * 600 / 1000;
  const int mainGap = std::max(6, height * 18 / 1000);
  const int mainHeight = std::max(1, height - radarHeight - mainGap);
  const int targetControlsHeight = std::max(1, mainHeight * 270 / 1000);
  const int availableForCards = std::max(3, height - gap * 3);
  const int controlsHeight = std::clamp(
      targetControlsHeight, 1, std::max(1, availableForCards - 2));
  const int cardHeight = std::max(1, (availableForCards - controlsHeight) / 3);

  SidebarSections sections;
  int top = client.top;
  sections.clock = RECT{client.left, top, client.right, top + cardHeight};
  top = sections.clock.bottom + gap;
  sections.air = RECT{client.left, top, client.right, top + cardHeight};
  top = sections.air.bottom + gap;
  sections.weather = RECT{client.left, top, client.right, top + cardHeight};
  top = sections.weather.bottom + gap;
  sections.controls = RECT{client.left, top, client.right, top + controlsHeight};
  return sections;
}

struct MainSections {
  RECT music{};
  RECT energy{};
  RECT news{};
};

MainSections SplitMainSections(const RECT& client) {
  const int width = std::max(1L, client.right - client.left);
  const int height = std::max(1L, client.bottom - client.top);
  const int gapX = std::max(8, width * 16 / 1000);
  const int gapY = std::max(6, height * 45 / 1000);
  const int newsHeight = height * 270 / 1000;
  const int musicWidth = width * 480 / 1000;
  MainSections sections;
  sections.news = RECT{client.left, client.bottom - newsHeight, client.right, client.bottom};
  const LONG rowBottom = std::max(client.top + 1, sections.news.top - gapY);
  sections.music = RECT{client.left, client.top, client.left + musicWidth, rowBottom};
  sections.energy = RECT{sections.music.right + gapX, client.top, client.right, rowBottom};
  if (sections.energy.right <= sections.energy.left) {
    sections.energy.right = sections.energy.left + 1;
  }
  return sections;
}''',
    '''struct SidebarSections {
  RECT clock{};
  RECT weather{};
  RECT energy{};
  RECT controls{};
};

SidebarSections SplitSidebarSections(const RECT& client) {
  const int height = std::max(1L, client.bottom - client.top);
  const int gap = std::max(6, height * 18 / 1000);

  // The sidebar and main panel share the same inner dashboard height. Mirror
  // SplitMainSections' radar/news proportions so the controls card lines up
  // with the news card, then split the rest evenly across the clock,
  // weather-forecast, and energy cards so all three share one height.
  const int radarHeight = height * 600 / 1000;
  const int mainGap = std::max(6, height * 18 / 1000);
  const int mainHeight = std::max(1, height - radarHeight - mainGap);
  const int targetControlsHeight = std::max(1, mainHeight * 270 / 1000);
  const int availableForCards = std::max(3, height - gap * 3);
  const int controlsHeight = std::clamp(
      targetControlsHeight, 1, std::max(1, availableForCards - 2));
  const int cardHeight = std::max(1, (availableForCards - controlsHeight) / 3);

  SidebarSections sections;
  int top = client.top;
  sections.clock = RECT{client.left, top, client.right, top + cardHeight};
  top = sections.clock.bottom + gap;
  sections.weather = RECT{client.left, top, client.right, top + cardHeight};
  top = sections.weather.bottom + gap;
  sections.energy = RECT{client.left, top, client.right, top + cardHeight};
  top = sections.energy.bottom + gap;
  sections.controls = RECT{client.left, top, client.right, top + controlsHeight};
  return sections;
}

struct MainSections {
  RECT music{};
  RECT air{};
  RECT news{};
};

MainSections SplitMainSections(const RECT& client) {
  const int width = std::max(1L, client.right - client.left);
  const int height = std::max(1L, client.bottom - client.top);
  const int gapX = std::max(8, width * 16 / 1000);
  const int gapY = std::max(6, height * 45 / 1000);
  const int newsHeight = height * 270 / 1000;
  const int musicWidth = width * 480 / 1000;
  MainSections sections;
  sections.news = RECT{client.left, client.bottom - newsHeight, client.right, client.bottom};
  const LONG rowBottom = std::max(client.top + 1, sections.news.top - gapY);
  sections.music = RECT{client.left, client.top, client.left + musicWidth, rowBottom};
  sections.air = RECT{sections.music.right + gapX, client.top, client.right, rowBottom};
  if (sections.air.right <= sections.air.left) {
    sections.air.right = sections.air.left + 1;
  }
  return sections;
}''',
    "part1 section names",
)

panel_files = [part1, read("native/src/renderer_panels/part2.inc"),
               read("native/src/renderer_panels/part3.inc"),
               read("native/src/renderer_panels/part4.inc")]
if sum(len(re.findall(r'\bDrawHeaderStatus\b', text)) for text in panel_files) == 1:
    part1 = sub_once(
        part1,
        r'\nvoid DrawHeaderStatus\(HDC dc, const RECT& header, const PanelDataStatus& status\) \{.*?\n\}\n\n(?=struct SidebarSections)',
        "\n",
        "part1 dead DrawHeaderStatus",
    )
for token, line in (
    ("kWidgetBlue", "constexpr COLORREF kWidgetBlue = RGB(10, 132, 255);\n"),
    ("kWidgetPurple", "constexpr COLORREF kWidgetPurple = RGB(175, 82, 222);\n"),
):
    combined = "\n".join(panel_files)
    if len(re.findall(rf'\b{token}\b', combined)) == 1:
        part1 = part1.replace(line, "")
write(part1_path, part1)

part2_path = "native/src/renderer_panels/part2.inc"
part2 = read(part2_path)
part2 = sub_once(
    part2,
    r'\nvoid Renderer::RebuildNativeAirGraph\(int64_t nowMs\) \{.*?\n\}\n\nvoid Renderer::DrawCachedPanelSection\(.*?\n\}\n\n(?=Renderer::NativePanelPaintScope)',
    "\n",
    "part2 cache methods",
)
part2 = sub_once(
    part2,
    r'  for \(auto& \[hwnd, buffer\] : nativeBackBuffers_\) \{.*?  radarBitmapUseCounter_ = 0;\n',
    "  ResetNativeBitmapCaches();\n",
    "part2 bitmap cleanup",
)
part2 = sub_once(
    part2,
    r'\nvoid Renderer::UpdateNativeStaticPanels\(const RenderState& state\) \{.*?\n\}\n\nvoid Renderer::TickNativePanels\(int64_t nowMs, bool timerDriven\) \{.*?\n\}\n\n(?=LRESULT Renderer::HandleNativeStaticMessage)',
    "\n",
    "part2 panel state methods",
)
part2 = replace_once(
    part2,
    '''      case PanelSection::Air: rect = sections.air; break;
      case PanelSection::Weather: rect = sections.weather; break;''',
    '''      case PanelSection::Weather: rect = sections.weather; break;
      case PanelSection::Energy: rect = sections.energy; break;''',
    "part2 sidebar invalidation names",
)
part2 = replace_once(
    part2,
    '''      case PanelSection::Energy: rect = sections.energy; break;
      case PanelSection::News: rect = sections.news; break;''',
    '''      case PanelSection::Air: rect = sections.air; break;
      case PanelSection::News: rect = sections.news; break;''',
    "part2 main invalidation names",
)
part2 = replace_once(
    part2,
    '''  if (IntersectRect(&overlap, &scope.dirty, &sections.air)) {
    DrawCachedPanelSection(scope.dc, sections.air, PanelSection::Weather,
                           dashboardWeatherRevision_, &Renderer::DrawWeatherSection);
  }
  if (IntersectRect(&overlap, &scope.dirty, &sections.weather)) {
    DrawCachedPanelSection(scope.dc, sections.weather, PanelSection::Energy,
                           dashboardEnergyRevision_, &Renderer::DrawEnergySection);
  }''',
    '''  if (IntersectRect(&overlap, &scope.dirty, &sections.weather)) {
    DrawCachedPanelSection(scope.dc, sections.weather, PanelSection::Weather,
                           dashboardRevisions_.weather, &Renderer::DrawWeatherSection);
  }
  if (IntersectRect(&overlap, &scope.dirty, &sections.energy)) {
    DrawCachedPanelSection(scope.dc, sections.energy, PanelSection::Energy,
                           dashboardRevisions_.energy, &Renderer::DrawEnergySection);
  }''',
    "part2 sidebar paint names",
)
part2 = replace_once(
    part2,
    '''  if (IntersectRect(&overlap, &scope.dirty, &sections.energy)) {
    DrawCachedPanelSection(scope.dc, sections.energy, PanelSection::Air,
                           nativeAirRenderRevision_, &Renderer::DrawAirSection);
  }''',
    '''  if (IntersectRect(&overlap, &scope.dirty, &sections.air)) {
    DrawCachedPanelSection(scope.dc, sections.air, PanelSection::Air,
                           nativeAirRenderRevision_, &Renderer::DrawAirSection);
  }''',
    "part2 main paint names",
)
write(part2_path, part2)

part4_path = "native/src/renderer_panels/part4.inc"
part4 = read(part4_path)
part4 = sub_once(
    part4,
    r'\nHBITMAP Renderer::NativePanelBackBuffer\(.*?\n\}\s*$',
    "\n}  // namespace hp\n",
    "part4 bitmap cache methods",
)
write(part4_path, part4)


# Shared file-cache helpers replace duplicate implementations in radar and
# embedded asset installation.
write("native/src/file_utils.h", '''#pragma once
#include "common.h"

namespace hp::file {

inline bool MatchesText(const fs::path& path, const std::string& content) {
  std::error_code error;
  if (!fs::is_regular_file(path, error) ||
      fs::file_size(path, error) != content.size()) {
    return false;
  }
  std::ifstream input(path, std::ios::binary);
  return input && std::equal(std::istreambuf_iterator<char>(input),
                             std::istreambuf_iterator<char>(),
                             content.begin(), content.end());
}

inline bool NonEmpty(const fs::path& path) {
  std::error_code error;
  return fs::is_regular_file(path, error) && fs::file_size(path, error) > 0;
}

inline std::string Stamp(const fs::path& path) {
  std::error_code error;
  const auto size = fs::file_size(path, error);
  if (error) return "missing";
  std::ostringstream stamp;
  stamp << size;
  const auto modified = fs::last_write_time(path, error);
  if (!error) stamp << ':' << modified.time_since_epoch().count();
  return stamp.str();
}

}  // namespace hp::file
''')

embedded = read("native/src/embedded_ui.cpp")
embedded = embedded.replace('#include "common.h"\n', '#include "common.h"\n#include "file_utils.h"\n')
embedded = sub_once(
    embedded,
    r'\nbool FileMatches\(const fs::path& path, const std::string& content\) \{.*?\n\}\n\nbool NonEmptyFile\(const fs::path& path\) \{.*?\n\}\n',
    "\n",
    "embedded_ui duplicate file helpers",
)
embedded = sub_once(
    embedded,
    r'\nuint64_t HashBytes\(const std::string& content\) \{.*?\n\}\n',
    "\n",
    "embedded_ui duplicate hash",
)
embedded = embedded.replace("FileMatches(path, content)", "file::MatchesText(path, content)")
embedded = embedded.replace("FileMatches(folder / L\"native-assets.signature\", stamp)",
                            "file::MatchesText(folder / L\"native-assets.signature\", stamp)")
embedded = embedded.replace("NonEmptyFile(", "file::NonEmpty(")
embedded = embedded.replace("HashBytes(content)", "Fnv1a64(content)")
embedded = embedded.replace("native-assets-v2", "native-assets-v3")
write("native/src/embedded_ui.cpp", embedded)


# Radar composition keeps composition only; decoded bitmap ownership moves to
# renderer_bitmap_cache.cpp. Tile stamps are computed once and included in the
# frame signature so same-URL tile replacement is detected.
radar_path = "native/src/renderer_radar_ui.cpp"
radar = read(radar_path)
radar = radar.replace('#include "web_renderer.h"\n', '#include "web_renderer.h"\n#include "file_utils.h"\n')
radar = radar.replace("constexpr size_t kRadarBitmapCacheLimit = 16;\n", "")
radar = replace_once(
    radar,
    '''struct RadarTile {
  std::wstring url;
  POINT destination{};
};''',
    '''struct RadarTile {
  std::wstring url;
  POINT destination{};
  fs::path path;
  std::string fileStamp;
};''',
    "radar tile metadata",
)
radar = radar.replace("std::optional<fs::path> RadarTilePath(const fs::path& dataDir,\n                                             const std::wstring& url)",
                      "std::optional<fs::path> RadarTilePath(const fs::path& dataDir,\n                                             const std::wstring& url)")
radar = sub_once(
    radar,
    r'\nbool FileMatchesText\(const fs::path& path, const std::string& content\) \{.*?\n\}\n\nstd::string FileStamp\(const fs::path& path\) \{.*?\n\}\n',
    "\n",
    "radar duplicate file helpers",
)
radar = sub_once(
    radar,
    r'\nHBITMAP Renderer::CachedRadarBitmap\(.*?\n\}\n\n(?=void Renderer::StartRadarCompose)',
    "\n",
    "radar cache implementation",
)
radar = replace_once(
    radar,
    '''}  // namespace

void Renderer::StartRadarCompose() {''',
    '''}  // namespace

void Renderer::NotifyRadarUpdated() {
  if (!radarComposeStarted_.load(std::memory_order_acquire)) return;
  {
    std::lock_guard lock(radarComposeWakeMutex_);
    radarComposePending_ = true;
  }
  radarComposeWake_.notify_all();
}

void Renderer::StartRadarCompose() {''',
    "radar NotifyRadarUpdated",
)
radar = replace_once(
    radar,
    '''  const fs::path satellitePath = uiDir / L"radar-satellite.png";
  const fs::path mapPath = uiDir / L"radar-map.png";''',
    '''  const fs::path satellitePath = uiDir / L"radar-satellite.png";
  const fs::path mapPath = uiDir / L"radar-map.png";
  const std::string satelliteStamp = file::Stamp(satellitePath);
  const std::string mapStamp = file::Stamp(mapPath);''',
    "radar base stamps",
)
radar = radar.replace('L"native-radar-v4|"', 'L"native-radar-v5|"')
radar = radar.replace("Utf8ToWide(FileStamp(satellitePath))", "Utf8ToWide(satelliteStamp)")
radar = radar.replace("Utf8ToWide(FileStamp(mapPath))", "Utf8ToWide(mapStamp)")
radar = replace_once(
    radar,
    '''          tiles.push_back(RadarTile{url, destination});
          signatureStream << L"|" << url << L"@" << destination.x << L"," << destination.y;''',
    '''          const std::optional<fs::path> tilePath = RadarTilePath(dataDir_, url);
          const std::string tileStamp = tilePath ? file::Stamp(*tilePath) : "invalid";
          tiles.push_back(RadarTile{
              url, destination, tilePath.value_or(fs::path{}), tileStamp});
          signatureStream << L"|" << url << L"@" << destination.x << L"," << destination.y
                          << L"#" << Utf8ToWide(tileStamp);''',
    "radar tile signature",
)
radar = radar.replace("FileMatchesText(cachedSignature, signatureUtf8)",
                      "file::MatchesText(cachedSignature, signatureUtf8)")
radar = replace_once(
    radar,
    '''  HBITMAP radarSatelliteBitmap = CachedRadarBitmap(
      L"radar-satellite", satellitePath, kRadarCanvasWidth, kRadarCanvasHeight);
  HBITMAP radarMapBitmap = CachedRadarBitmap(
      L"radar-map", mapPath, kRadarCanvasWidth, kRadarCanvasHeight);''',
    '''  HBITMAP radarSatelliteBitmap = CachedRadarBitmap(
      L"radar-satellite", satellitePath, satelliteStamp,
      kRadarCanvasWidth, kRadarCanvasHeight);
  HBITMAP radarMapBitmap = CachedRadarBitmap(
      L"radar-map", mapPath, mapStamp, kRadarCanvasWidth, kRadarCanvasHeight);''',
    "radar base cache calls",
)
radar = replace_once(
    radar,
    '''    const std::optional<fs::path> tilePath = RadarTilePath(dataDir_, tile.url);
    HBITMAP tileBitmap = tilePath
        ? CachedRadarBitmap(L"radar-tile:" + tile.url, *tilePath, tileWidth, tileHeight)
        : nullptr;''',
    '''    HBITMAP tileBitmap = tile.path.empty()
        ? nullptr
        : CachedRadarBitmap(L"radar-tile:" + tile.url, tile.path,
                            tile.fileStamp, tileWidth, tileHeight);''',
    "radar tile cache call",
)
write(radar_path, radar)


# Dashboard file loading and section change detection.
write("native/src/renderer_dashboard.cpp", '''#include "web_renderer.h"

namespace hp {

bool Renderer::LoadDashboard(const fs::path& jsonPath, bool* changed) {
  if (changed) *changed = false;
  try {
    std::error_code error;
    const fs::path normalizedPath = jsonPath.lexically_normal();
    const std::uintmax_t sourceSize = fs::file_size(normalizedPath, error);
    if (error) return false;
    const fs::file_time_type modifiedAt = fs::last_write_time(normalizedPath, error);
    if (error) return false;

    const DashboardSourceStamp nextStamp{
        normalizedPath, sourceSize, modifiedAt, true};
    if (dashboardSourceStamp_.valid &&
        dashboardSourceStamp_.path == nextStamp.path &&
        dashboardSourceStamp_.size == nextStamp.size &&
        dashboardSourceStamp_.modifiedAt == nextStamp.modifiedAt) {
      return true;
    }

    std::ifstream input(normalizedPath, std::ios::binary);
    if (!input) return false;
    std::string text((std::istreambuf_iterator<char>(input)), {});
    if (text.empty()) return false;
    if (text == dashboardUtf8_) {
      dashboardSourceStamp_ = nextStamp;
      return true;
    }

    DashboardSnapshot snapshot;
    if (!ParseDashboardSnapshot(text, snapshot)) return false;
    const bool firstSnapshot = !nativeDashboard_.loaded;
    const bool weatherChanged = firstSnapshot ||
        snapshot.revisions.weather != nativeDashboard_.revisions.weather;
    const bool energyChanged = firstSnapshot ||
        snapshot.revisions.energy != nativeDashboard_.revisions.energy;
    const bool newsChanged = firstSnapshot ||
        snapshot.revisions.news != nativeDashboard_.revisions.news;
    const bool contentChanged = weatherChanged || energyChanged || newsChanged;

    newsCount_ = snapshot.newsItemCount;
    nativeDashboard_ = std::move(snapshot);
    dashboardUtf8_ = std::move(text);
    dashboardSourceStamp_ = nextStamp;
    if (weatherChanged) ++dashboardRevisions_.weather;
    if (energyChanged) ++dashboardRevisions_.energy;
    if (newsChanged) ++dashboardRevisions_.news;
    if (changed) *changed = contentChanged;
    return true;
  } catch (...) {
    return false;
  }
}

}  // namespace hp
''')


# Panel state projection and invalidation policy.
write("native/src/renderer_panel_state.cpp", '''#include "web_renderer.h"

namespace hp {

void Renderer::RebuildNativeAirGraph(int64_t nowMs) {
  constexpr int64_t kWindowMs = 24LL * 60 * 60 * 1000;
  AirGraphProjection next;
  next.cutoff = nowMs - kWindowMs;
  next.samples.reserve(nativeAirHistory_.size());
  double co2Min = std::numeric_limits<double>::max();
  double co2Max = std::numeric_limits<double>::lowest();
  double temperatureMin = std::numeric_limits<double>::max();
  double temperatureMax = std::numeric_limits<double>::lowest();
  double humidityMin = std::numeric_limits<double>::max();
  double humidityMax = std::numeric_limits<double>::lowest();
  for (const auto& sample : nativeAirHistory_) {
    if (sample.timestamp < next.cutoff || sample.co2 < 250 || sample.co2 > 10000 ||
        sample.temperature < -40 || sample.temperature > 85 ||
        sample.humidity < 0 || sample.humidity > 100) {
      continue;
    }
    next.samples.push_back(sample);
    co2Min = std::min(co2Min, static_cast<double>(sample.co2));
    co2Max = std::max(co2Max, static_cast<double>(sample.co2));
    temperatureMin = std::min(temperatureMin, sample.temperature);
    temperatureMax = std::max(temperatureMax, sample.temperature);
    humidityMin = std::min(humidityMin, sample.humidity);
    humidityMax = std::max(humidityMax, sample.humidity);
  }
  if (!next.samples.empty()) {
    next.co2Min = co2Min;
    next.co2Max = co2Max;
    next.temperatureMin = temperatureMin;
    next.temperatureMax = temperatureMax;
    next.humidityMin = humidityMin;
    next.humidityMax = humidityMax;
  }
  nativeAirGraph_ = std::move(next);
}

void Renderer::UpdateNativeStaticPanels(const RenderState& state) {
  const bool sensorsChanged = nativeSensors_ != state.sensors;
  const bool historyChanged = nativeAirHistory_ != state.airHistory;
  const bool stationheadChanged = nativeStationhead_ != state.stationhead;
  const bool stationheadHistoryChanged =
      nativeStationheadPlayHistory_ != state.stationheadPlayHistory;
  const bool controlsChanged =
      nativeAppVersion_ != state.appVersion || nativeToast_ != state.toast;
  const bool newsIndexChanged = nativeNewsIndex_ != state.newsIndex;
  const bool weatherChanged =
      renderedDashboardRevisions_.weather != dashboardRevisions_.weather;
  const bool energyChanged =
      renderedDashboardRevisions_.energy != dashboardRevisions_.energy;
  const bool newsChanged =
      renderedDashboardRevisions_.news != dashboardRevisions_.news;

  if (sensorsChanged) nativeSensors_ = state.sensors;
  if (historyChanged) {
    nativeAirHistory_ = state.airHistory;
    RebuildNativeAirGraph(UnixMillis());
  }
  if (sensorsChanged || historyChanged) ++nativeAirRenderRevision_;
  if (stationheadHistoryChanged) {
    nativeStationheadPlayHistory_ = state.stationheadPlayHistory;
  }
  if (stationheadChanged) nativeStationhead_ = state.stationhead;
  if (controlsChanged) {
    nativeAppVersion_ = state.appVersion;
    nativeToast_ = state.toast;
  }
  if (newsIndexChanged) nativeNewsIndex_ = state.newsIndex;
  if (weatherChanged) {
    renderedDashboardRevisions_.weather = dashboardRevisions_.weather;
  }
  if (energyChanged) {
    renderedDashboardRevisions_.energy = dashboardRevisions_.energy;
  }
  if (newsChanged) {
    renderedDashboardRevisions_.news = dashboardRevisions_.news;
  }
  if (newsChanged || newsIndexChanged) ++nativeNewsRenderRevision_;

  if (!EnsureNativeStaticWindows()) return;
  if (sensorsChanged || historyChanged) {
    InvalidatePanelSection(nativeMainWindow_, PanelSection::Air);
  }
  if (weatherChanged) {
    InvalidatePanelSection(nativeSideWindow_, PanelSection::Weather);
  }
  if (energyChanged) {
    InvalidatePanelSection(nativeSideWindow_, PanelSection::Energy);
  }
  if (newsChanged || newsIndexChanged) {
    InvalidatePanelSection(nativeMainWindow_, PanelSection::News);
  }
  if (controlsChanged) {
    InvalidatePanelSection(nativeSideWindow_, PanelSection::Controls);
  }
  if (stationheadChanged || stationheadHistoryChanged) {
    InvalidatePanelSection(nativeMainWindow_, PanelSection::Music);
  }
}

void Renderer::TickNativePanels(int64_t nowMs, bool timerDriven) {
  if (!nativeDashboardVisible_ || (!timerDriven && nativePanelTimerActive_)) return;

  SYSTEMTIME localTime{};
  GetLocalTime(&localTime);
  const int clockDayKey = static_cast<int>(localTime.wYear) * 10'000 +
      static_cast<int>(localTime.wMonth) * 100 + static_cast<int>(localTime.wDay);
  const bool clockDayChanged = clockDayKey != nativeClockDayKey_;
  nativeClockDayKey_ = clockDayKey;

  const NativePlaybackTickState playbackState = NativePlaybackTickStateFor(nowMs);
  const bool playbackChanged = playbackState != nativePlaybackTickState_;
  nativePlaybackTickState_ = playbackState;
  if (nativeSideWindow_ && IsWindow(nativeSideWindow_) &&
      IsWindowVisible(nativeSideWindow_)) {
    InvalidatePanelSection(nativeSideWindow_,
                           clockDayChanged ? PanelSection::Clock : PanelSection::ClockTime);
  }
  if (nativeMainWindow_ && IsWindow(nativeMainWindow_) &&
      IsWindowVisible(nativeMainWindow_)) {
    if (playbackChanged) {
      InvalidatePanelSection(nativeMainWindow_, PanelSection::Music);
    } else if (playbackState.active) {
      InvalidatePanelSection(nativeMainWindow_, PanelSection::PlaybackProgress);
    }
  }
}

}  // namespace hp
''')


# All decoded bitmap ownership and eviction policy lives here.
write("native/src/renderer_bitmap_cache.cpp", '''#include "web_renderer.h"
#include "wic_image.h"

namespace hp {
namespace {
constexpr size_t kNativeImageBitmapCacheLimit = 24;
constexpr size_t kRadarBitmapCacheLimit = 16;

struct CachedBitmapMemoryDc {
  HDC value = nullptr;
  ~CachedBitmapMemoryDc() {
    if (value) DeleteDC(value);
  }
};

HDC BitmapMemoryDc(HDC compatibleDc) {
  thread_local CachedBitmapMemoryDc cached;
  if (!cached.value) cached.value = CreateCompatibleDC(compatibleDc);
  return cached.value;
}

HBRUSH BitmapCacheBackgroundBrush() {
  static HBRUSH brush = CreateSolidBrush(kNativeDashboardBackground);
  return brush;
}

bool IsPersistentRadarBitmap(const std::wstring& key) {
  return key.rfind(L"radar-satellite#", 0) == 0 ||
         key.rfind(L"radar-map#", 0) == 0;
}
}  // namespace

void Renderer::DrawCachedPanelSection(
    HDC dc, const RECT& card, PanelSection section, uint64_t revision,
    void (Renderer::*draw)(HDC, const RECT&)) {
  const int width = std::max(1, static_cast<int>(card.right - card.left));
  const int height = std::max(1, static_cast<int>(card.bottom - card.top));
  PanelBitmapCache& cache = nativeSectionBitmaps_[section];
  const bool stale = !cache.bitmap || cache.width != width || cache.height != height ||
      cache.revision != revision || cache.layoutRevision != nativeLayoutRevision_;
  HDC memoryDc = BitmapMemoryDc(dc);
  if (stale) {
    HBITMAP bitmap = CreateCompatibleBitmap(dc, width, height);
    if (!bitmap || !memoryDc) {
      if (bitmap) DeleteObject(bitmap);
      (this->*draw)(dc, card);
      return;
    }
    HGDIOBJ previous = SelectObject(memoryDc, bitmap);
    const RECT local{0, 0, width, height};
    FillRect(memoryDc, &local, BitmapCacheBackgroundBrush());
    SetBkMode(memoryDc, TRANSPARENT);
    (this->*draw)(memoryDc, local);
    SelectObject(memoryDc, previous);
    if (cache.bitmap) DeleteObject(cache.bitmap);
    cache = PanelBitmapCache{bitmap, width, height, revision, nativeLayoutRevision_};
  }
  if (!cache.bitmap || !memoryDc) {
    (this->*draw)(dc, card);
    return;
  }
  HGDIOBJ previous = SelectObject(memoryDc, cache.bitmap);
  BitBlt(dc, card.left, card.top, width, height, memoryDc, 0, 0, SRCCOPY);
  SelectObject(memoryDc, previous);
}

HBITMAP Renderer::NativePanelBackBuffer(HWND hwnd, HDC dc, int width, int height) {
  if (!hwnd || !dc || width <= 0 || height <= 0) return nullptr;
  PanelBackBuffer& buffer = nativeBackBuffers_[hwnd];
  if (buffer.bitmap && buffer.width == width && buffer.height == height) {
    return buffer.bitmap;
  }
  if (buffer.bitmap) DeleteObject(buffer.bitmap);
  buffer.bitmap = CreateCompatibleBitmap(dc, width, height);
  buffer.width = buffer.bitmap ? width : 0;
  buffer.height = buffer.bitmap ? height : 0;
  return buffer.bitmap;
}

void Renderer::ReleaseNativePanelBackBuffer(HWND hwnd) {
  const auto found = nativeBackBuffers_.find(hwnd);
  if (found == nativeBackBuffers_.end()) return;
  if (found->second.bitmap) DeleteObject(found->second.bitmap);
  nativeBackBuffers_.erase(found);
}

HBITMAP Renderer::NativeArtworkBitmap(const std::wstring& url, int width, int height) {
  if (url.empty() || width <= 0 || height <= 0) return nullptr;
  static constexpr wchar_t kDataHostPrefix[] = L"https://data.homepanel/";
  if (url.rfind(kDataHostPrefix, 0) != 0) return nullptr;

  const std::wstring key = url + L"#" + std::to_wstring(width) + L"x" +
      std::to_wstring(height);
  auto found = nativeImageBitmaps_.find(key);
  if (found != nativeImageBitmaps_.end()) {
    found->second.lastUsed = ++nativeImageUseCounter_;
    return found->second.bitmap;
  }

  std::wstring relative = url.substr(std::size(kDataHostPrefix) - 1);
  if (relative.empty() || relative.find(L"..") != std::wstring::npos) return nullptr;
  for (auto& character : relative) {
    if (character == L'/') character = L'\\';
  }
  return CacheNativeImageBitmap(
      key, DecodeImageFileToBitmap(dataDir_ / relative, width, height));
}

HBITMAP Renderer::NativeWeatherIconBitmap(
    const std::wstring& icon, bool night, int width, int height) {
  if (icon.empty() || width <= 0 || height <= 0) return nullptr;
  for (wchar_t character : icon) {
    if (character < L'0' || character > L'9') return nullptr;
  }
  const std::wstring fileName = icon + (night ? L"_night.png" : L"_day.png");
  const std::wstring key = L"weather-icon:" + fileName + L"#" +
      std::to_wstring(width) + L"x" + std::to_wstring(height);
  auto found = nativeImageBitmaps_.find(key);
  if (found != nativeImageBitmaps_.end()) {
    found->second.lastUsed = ++nativeImageUseCounter_;
    return found->second.bitmap;
  }

  const auto decodeIcon = [&](const std::wstring& name) {
    return DecodeImageFileToBitmap(
        rootDir_ / L"ui" / L"weather-icons" / name, width, height);
  };
  HBITMAP bitmap = decodeIcon(fileName);
  if (!bitmap && night) bitmap = decodeIcon(icon + L"_day.png");
  if (!bitmap) {
    const wchar_t family = icon.front();
    const std::wstring fallback = family == L'2' ? L"200" :
        family == L'3' ? L"300" : family == L'4' ? L"400" : L"100";
    bitmap = decodeIcon(fallback + (night ? L"_night.png" : L"_day.png"));
    if (!bitmap && night) bitmap = decodeIcon(fallback + L"_day.png");
  }
  return CacheNativeImageBitmap(key, bitmap);
}

HBITMAP Renderer::CacheNativeImageBitmap(const std::wstring& key, HBITMAP bitmap) {
  if (!bitmap) return nullptr;
  if (nativeImageBitmaps_.size() >= kNativeImageBitmapCacheLimit) {
    auto oldest = nativeImageBitmaps_.begin();
    for (auto item = nativeImageBitmaps_.begin();
         item != nativeImageBitmaps_.end(); ++item) {
      if (item->second.lastUsed < oldest->second.lastUsed) oldest = item;
    }
    if (oldest->second.bitmap) DeleteObject(oldest->second.bitmap);
    nativeImageBitmaps_.erase(oldest);
  }
  nativeImageBitmaps_[key] = BitmapCacheEntry{bitmap, ++nativeImageUseCounter_};
  return bitmap;
}

HBITMAP Renderer::CachedRadarBitmap(
    const std::wstring& key, const fs::path& path, const std::string& fileStamp,
    int width, int height) {
  if (width <= 0 || height <= 0) return nullptr;
  const std::wstring keyPrefix = key + L"#";
  const std::wstring cacheKey = keyPrefix + Utf8ToWide(fileStamp) + L"#" +
      std::to_wstring(width) + L"x" + std::to_wstring(height);
  auto found = nativeRadarBitmaps_.find(cacheKey);
  if (found != nativeRadarBitmaps_.end()) {
    found->second.lastUsed = ++nativeRadarBitmapUseCounter_;
    return found->second.bitmap;
  }

  HBITMAP bitmap = DecodeImageFileToBitmap(path, width, height);
  if (!bitmap) return nullptr;
  for (auto item = nativeRadarBitmaps_.begin(); item != nativeRadarBitmaps_.end();) {
    if (item->first.rfind(keyPrefix, 0) != 0) {
      ++item;
      continue;
    }
    if (item->second.bitmap) DeleteObject(item->second.bitmap);
    item = nativeRadarBitmaps_.erase(item);
  }
  if (nativeRadarBitmaps_.size() >= kRadarBitmapCacheLimit) {
    auto oldest = nativeRadarBitmaps_.end();
    for (auto item = nativeRadarBitmaps_.begin();
         item != nativeRadarBitmaps_.end(); ++item) {
      if (IsPersistentRadarBitmap(item->first)) continue;
      if (oldest == nativeRadarBitmaps_.end() ||
          item->second.lastUsed < oldest->second.lastUsed) {
        oldest = item;
      }
    }
    if (oldest != nativeRadarBitmaps_.end()) {
      if (oldest->second.bitmap) DeleteObject(oldest->second.bitmap);
      nativeRadarBitmaps_.erase(oldest);
    }
  }
  nativeRadarBitmaps_[cacheKey] =
      BitmapCacheEntry{bitmap, ++nativeRadarBitmapUseCounter_};
  return bitmap;
}

void Renderer::ResetNativeBitmapCaches() noexcept {
  for (auto& [hwnd, buffer] : nativeBackBuffers_) {
    if (buffer.bitmap) DeleteObject(buffer.bitmap);
  }
  nativeBackBuffers_.clear();
  for (auto& [section, cache] : nativeSectionBitmaps_) {
    if (cache.bitmap) DeleteObject(cache.bitmap);
  }
  nativeSectionBitmaps_.clear();
  for (auto& [key, entry] : nativeImageBitmaps_) {
    if (entry.bitmap) DeleteObject(entry.bitmap);
  }
  nativeImageBitmaps_.clear();
  nativeImageUseCounter_ = 0;
  for (auto& [key, entry] : nativeRadarBitmaps_) {
    if (entry.bitmap) DeleteObject(entry.bitmap);
  }
  nativeRadarBitmaps_.clear();
  nativeRadarBitmapUseCounter_ = 0;
}

}  // namespace hp
''')

Path("native/src/renderer_core.cpp").unlink()
