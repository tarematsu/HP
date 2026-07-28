#include "web_renderer.h"
#include "file_utils.h"
#include "wic_image.h"
#include "json_helpers.h"
#include <set>
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
constexpr int64_t kRadarTileFailureTtlMs = 5 * 60'000;
constexpr int64_t kDefaultRadarFrameIntervalMs = 5'000;
constexpr size_t kRadarRainPresenceCacheLimit = 512;
constexpr wchar_t kNoRainMessage[] = L"しばらく雨は降りません";
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

struct RadarTile {
  std::wstring url;
  POINT destination{};
  fs::path path;
  std::string fileStamp;
};

struct RadarRainPresence {
  std::string fileStamp;
  bool hasRain = true;
};

struct CachedRadarSourceDc {
  HDC value = nullptr;
  ~CachedRadarSourceDc() {
    if (value) DeleteDC(value);
  }
};

struct ScopedRadarComApartment {
  HRESULT result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  ~ScopedRadarComApartment() {
    if (SUCCEEDED(result)) CoUninitialize();
  }
};

struct RadarCompositionSurface {
  HBITMAP bitmap = nullptr;
  HDC dc = nullptr;
  HGDIOBJ previous = nullptr;

  RadarCompositionSurface() = default;
  RadarCompositionSurface(const RadarCompositionSurface&) = delete;
  RadarCompositionSurface& operator=(const RadarCompositionSurface&) = delete;

  ~RadarCompositionSurface() {
    Reset();
  }

  bool Initialize(const BITMAPINFO& info, void** pixels) noexcept {
    bitmap = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, pixels, nullptr, 0);
    if (!bitmap) return false;
    dc = CreateCompatibleDC(nullptr);
    if (!dc) return false;
    previous = SelectObject(dc, bitmap);
    return previous && previous != HGDI_ERROR;
  }

  void FinishDrawing() noexcept {
    if (!dc) return;
    if (previous && previous != HGDI_ERROR) SelectObject(dc, previous);
    DeleteDC(dc);
    dc = nullptr;
    previous = nullptr;
  }

  void Reset() noexcept {
    FinishDrawing();
    if (bitmap) DeleteObject(bitmap);
    bitmap = nullptr;
  }

  HBITMAP Release() noexcept {
    FinishDrawing();
    HBITMAP released = bitmap;
    bitmap = nullptr;
    return released;
  }
};

HDC RadarSourceDc(HDC compatibleDc) {
  thread_local CachedRadarSourceDc cached;
  if (!cached.value) cached.value = CreateCompatibleDC(compatibleDc);
  return cached.value;
}

int64_t RadarAnimationIntervalFromSignature(const std::wstring& signature) noexcept {
  static constexpr wchar_t kMarker[] = L"|animate:";
  size_t position = signature.find(kMarker);
  if (position == std::wstring::npos) return 0;
  position += std::size(kMarker) - 1;
  int64_t value = 0;
  bool hasDigit = false;
  while (position < signature.size()) {
    const wchar_t character = signature[position++];
    if (character < L'0' || character > L'9') break;
    hasDigit = true;
    value = std::min<int64_t>(60'000, value * 10 + (character - L'0'));
  }
  return hasDigit && value >= 1'000 ? value : 0;
}

void InvalidateRadarWindow(HWND window) {
  if (window && IsWindow(window) && IsWindowVisible(window)) {
    InvalidateRect(window, nullptr, FALSE);
  }
}

std::wstring RadarTimeFromMillis(int64_t milliseconds) {
  if (milliseconds <= 0) return {};
  const time_t seconds = static_cast<time_t>(milliseconds / 1000);
  tm local{};
  if (localtime_s(&local, &seconds) != 0) return {};
  wchar_t text[16]{};
  swprintf_s(text, L"%02d:%02d", local.tm_hour, local.tm_min);
  return text;
}

std::optional<fs::path> RadarTilePath(const fs::path& dataDir,
                                      const std::wstring& url) {
  static constexpr wchar_t kDataHostPrefix[] = L"https://data.homepanel/";
  if (url.empty() || url.rfind(kDataHostPrefix, 0) != 0) return std::nullopt;
  std::wstring relative = url.substr(std::size(kDataHostPrefix) - 1);
  if (relative.empty() || relative.find(L"..") != std::wstring::npos) return std::nullopt;
  for (auto& character : relative) {
    if (character == L'/') character = L'\\';
  }
  return dataDir / relative;
}

bool TileFailureActive(const std::map<std::wstring, int64_t>& failures,
                       const std::wstring& url, int64_t now) {
  const auto item = failures.find(url);
  return item != failures.end() && item->second > now;
}

std::optional<RECT> RadarVisibleTileRect(
    const RadarTile& tile, int sourceWidth, int sourceHeight) {
  if (sourceWidth <= 0 || sourceHeight <= 0) return std::nullopt;
  const int64_t destinationX = tile.destination.x;
  const int64_t destinationY = tile.destination.y;
  const int64_t left = std::clamp<int64_t>(-destinationX, 0, 256);
  const int64_t top = std::clamp<int64_t>(-destinationY, 0, 256);
  const int64_t right = std::clamp<int64_t>(
      static_cast<int64_t>(sourceWidth) - destinationX, 0, 256);
  const int64_t bottom = std::clamp<int64_t>(
      static_cast<int64_t>(sourceHeight) - destinationY, 0, 256);
  if (right <= left || bottom <= top) return std::nullopt;
  return RECT{
      static_cast<LONG>(left), static_cast<LONG>(top),
      static_cast<LONG>(right), static_cast<LONG>(bottom)};
}

bool BitmapHasVisiblePixels(HBITMAP bitmap, const RECT& area) {
  BITMAP details{};
  if (!bitmap || GetObjectW(bitmap, sizeof(details), &details) != sizeof(details) ||
      !details.bmBits || details.bmBitsPixel != 32 || details.bmWidth <= 0 ||
      details.bmHeight == 0 || details.bmWidthBytes <= 0) {
    // Fail closed: an unreadable bitmap must never be treated as a clear forecast.
    return true;
  }
  const int width = details.bmWidth;
  const int height = details.bmHeight < 0 ? -details.bmHeight : details.bmHeight;
  if (area.left < 0 || area.top < 0 || area.right > width || area.bottom > height ||
      area.right <= area.left || area.bottom <= area.top) {
    return true;
  }
  const size_t stride = static_cast<size_t>(details.bmWidthBytes);
  const auto* pixels = static_cast<const uint8_t*>(details.bmBits);
  for (LONG y = area.top; y < area.bottom; ++y) {
    const uint8_t* const row = pixels + static_cast<size_t>(y) * stride;
    for (LONG x = area.left; x < area.right; ++x) {
      if (row[static_cast<size_t>(x) * 4 + 3] != 0) return true;
    }
  }
  return false;
}

bool RadarTileLayoutCoversSource(
    const std::set<std::pair<LONG, LONG>>& destinations,
    int sourceWidth, int sourceHeight) {
  if (destinations.empty() || sourceWidth <= 0 || sourceHeight <= 0) return false;
  std::vector<int64_t> xEdges{0, sourceWidth};
  std::vector<int64_t> yEdges{0, sourceHeight};
  xEdges.reserve(destinations.size() * 2 + 2);
  yEdges.reserve(destinations.size() * 2 + 2);
  for (const auto& [x, y] : destinations) {
    xEdges.push_back(std::clamp<int64_t>(x, 0, sourceWidth));
    xEdges.push_back(std::clamp<int64_t>(static_cast<int64_t>(x) + 256, 0, sourceWidth));
    yEdges.push_back(std::clamp<int64_t>(y, 0, sourceHeight));
    yEdges.push_back(std::clamp<int64_t>(static_cast<int64_t>(y) + 256, 0, sourceHeight));
  }
  const auto normalizeEdges = [](std::vector<int64_t>& edges) {
    std::sort(edges.begin(), edges.end());
    edges.erase(std::unique(edges.begin(), edges.end()), edges.end());
  };
  normalizeEdges(xEdges);
  normalizeEdges(yEdges);

  for (size_t xIndex = 0; xIndex + 1 < xEdges.size(); ++xIndex) {
    if (xEdges[xIndex] == xEdges[xIndex + 1]) continue;
    for (size_t yIndex = 0; yIndex + 1 < yEdges.size(); ++yIndex) {
      if (yEdges[yIndex] == yEdges[yIndex + 1]) continue;
      const int64_t sampleX = xEdges[xIndex];
      const int64_t sampleY = yEdges[yIndex];
      bool covered = false;
      for (const auto& [tileX, tileY] : destinations) {
        if (sampleX >= tileX && sampleX < static_cast<int64_t>(tileX) + 256 &&
            sampleY >= tileY && sampleY < static_cast<int64_t>(tileY) + 256) {
          covered = true;
          break;
        }
      }
      if (!covered) return false;
    }
  }
  return true;
}

std::optional<bool> RadarTileHasRain(
    const RadarTile& tile, int sourceWidth, int sourceHeight) {
  if (tile.url.empty() || tile.path.empty() || tile.fileStamp.empty() ||
      tile.fileStamp == "missing" || tile.fileStamp == "invalid") {
    return std::nullopt;
  }
  const std::optional<RECT> visible =
      RadarVisibleTileRect(tile, sourceWidth, sourceHeight);
  if (!visible) return std::nullopt;

  std::wostringstream cacheKeyStream;
  cacheKeyStream << tile.url << L"@" << tile.destination.x << L"," << tile.destination.y
                 << L"#" << sourceWidth << L"x" << sourceHeight;
  const std::wstring cacheKey = cacheKeyStream.str();
  static thread_local std::map<std::wstring, RadarRainPresence> cache;
  const auto found = cache.find(cacheKey);
  if (found != cache.end() && found->second.fileStamp == tile.fileStamp) {
    return found->second.hasRain;
  }

  HBITMAP bitmap = DecodeImageFileToBitmap(tile.path, 256, 256);
  if (!bitmap) return std::nullopt;
  const bool hasRain = BitmapHasVisiblePixels(bitmap, *visible);
  DeleteObject(bitmap);

  if (cache.size() >= kRadarRainPresenceCacheLimit && found == cache.end()) {
    cache.clear();
  }
  cache[cacheKey] = RadarRainPresence{tile.fileStamp, hasRain};
  return hasRain;
}

bool RadarForecastHasNoRain(
    const std::vector<RadarTile>& tiles, int sourceWidth, int sourceHeight) {
  if (tiles.empty()) return false;
  for (const RadarTile& tile : tiles) {
    const std::optional<bool> hasRain =
        RadarTileHasRain(tile, sourceWidth, sourceHeight);
    if (!hasRain.has_value() || *hasRain) return false;
  }
  return true;
}

bool SaveBitmapAsBmp(HBITMAP bitmap, const fs::path& path, int width, int height) {
  if (!bitmap || width <= 0 || height <= 0) return false;
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(info.bmiHeader);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;

  const size_t headerBytes = sizeof(BITMAPFILEHEADER) + sizeof(BITMAPINFOHEADER);
  const size_t pixelBytes = static_cast<size_t>(width) * static_cast<size_t>(height) * 4;
  if (pixelBytes > static_cast<size_t>(MAXDWORD) - headerBytes) return false;
  std::vector<uint8_t> bytes(headerBytes + pixelBytes);
  uint8_t* const pixels = bytes.data() + headerBytes;

  HDC dc = GetDC(nullptr);
  if (!dc) return false;
  const int lines = GetDIBits(
      dc, bitmap, 0, static_cast<UINT>(height), pixels, &info, DIB_RGB_COLORS);
  ReleaseDC(nullptr, dc);
  if (lines != height) return false;

  BITMAPFILEHEADER file{};
  file.bfType = 0x4d42;
  file.bfOffBits = static_cast<DWORD>(headerBytes);
  file.bfSize = static_cast<DWORD>(bytes.size());
  std::memcpy(bytes.data(), &file, sizeof(file));
  std::memcpy(bytes.data() + sizeof(file), &info.bmiHeader, sizeof(BITMAPINFOHEADER));
  return AtomicWriteBytes(path, bytes);
}

void BlendBitmap(HDC dc, HBITMAP bitmap, int left, int top, int width, int height) {
  if (!bitmap || width <= 0 || height <= 0) return;
  HDC sourceDc = RadarSourceDc(dc);
  if (!sourceDc) return;
  HGDIOBJ previous = SelectObject(sourceDc, bitmap);
  if (!previous || previous == HGDI_ERROR) return;
  const BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  AlphaBlend(dc, left, top, width, height, sourceDc, 0, 0, width, height, blend);
  SelectObject(sourceDc, previous);
}
}  // namespace

void Renderer::NotifyRadarUpdated() {
  if (!radarComposeStarted_.load(std::memory_order_acquire)) return;
  {
    std::lock_guard lock(radarComposeWakeMutex_);
    radarComposePending_ = true;
  }
  radarComposeWake_.notify_all();
}

void Renderer::StartRadarCompose() {
  if (radarComposeStarted_.exchange(true, std::memory_order_acq_rel)) return;
  radarComposeStopping_ = false;
  {
    std::lock_guard lock(radarComposeWakeMutex_);
    radarComposePending_ = true;
  }
  radarComposeThread_ = std::thread([this] {
    for (;;) {
      try {
        RadarComposeLoop();
        return;
      } catch (...) {
        OutputDebugStringW(L"HomePanel radar compose thread recovered from an exception\n");
        if (radarComposeStopping_.load(std::memory_order_acquire)) return;
        Sleep(1'000);
      }
    }
  });
}

void Renderer::StopRadarCompose() noexcept {
  if (!radarComposeStarted_.exchange(false, std::memory_order_acq_rel)) return;
  radarComposeStopping_ = true;
  radarComposeWake_.notify_all();
  if (radarComposeThread_.joinable()) radarComposeThread_.join();
}

void Renderer::RadarComposeLoop() {
  ScopedRadarComApartment apartment;
  while (!radarComposeStopping_.load(std::memory_order_acquire)) {
    int64_t animationIntervalMs = 0;
    {
      std::lock_guard lock(radarFrameMutex_);
      animationIntervalMs = RadarAnimationIntervalFromSignature(radarSignature_);
    }
    {
      std::unique_lock waitLock(radarComposeWakeMutex_);
      const auto wakeRequested = [this] {
        return radarComposePending_ ||
               radarComposeStopping_.load(std::memory_order_acquire);
      };
      if (animationIntervalMs > 0) {
        radarComposeWake_.wait_for(
            waitLock, std::chrono::milliseconds(animationIntervalMs), wakeRequested);
      } else {
        radarComposeWake_.wait(waitLock, wakeRequested);
      }
      if (radarComposeStopping_.load(std::memory_order_acquire)) break;
      radarComposePending_ = false;
    }
    try {
      ComposeRadarFrame();
    } catch (...) {
    }
  }
}

void Renderer::ComposeRadarFrame() {
  std::wstring json;
  try {
    std::ifstream input(dataDir_ / L"radar.json", std::ios::binary);
    if (input) {
      const std::string text((std::istreambuf_iterator<char>(input)), {});
      json = Utf8ToWide(text);
    }
  } catch (...) {
  }

  int sourceWidth = 480;
  int sourceHeight = 320;
  int64_t validAt = 0;
  int64_t animationIntervalMs = 0;
  bool precomposed = false;
  bool noRainForecast = false;
  std::wstring signature;
  std::vector<RadarTile> tiles;
  const fs::path uiDir = rootDir_ / L"ui";
  const fs::path satellitePath = uiDir / L"radar-satellite.png";
  const fs::path mapPath = uiDir / L"radar-map.png";
  const std::string satelliteStamp = file::Stamp(satellitePath);
  const std::string mapStamp = file::Stamp(mapPath);
  if (!json.empty()) {
    try {
      const JsonObject root = JsonObject::Parse(json);
      sourceWidth = std::max(1, static_cast<int>(json::Number(root, L"width", 480)));
      sourceHeight = std::max(1, static_cast<int>(json::Number(root, L"height", 320)));
      precomposed = json::Boolean(root, L"precomposed");
      const int64_t frameIntervalMs = std::clamp<int64_t>(
          static_cast<int64_t>(json::Number(root, L"frameIntervalMs", kDefaultRadarFrameIntervalMs)),
          1'000, 60'000);
      const JsonArray frames = json::Array(root, L"frames");
      if (frames.Size() > 0) {
        const uint32_t selectedIndex = static_cast<uint32_t>(
            (UnixMillis() / frameIntervalMs) % static_cast<int64_t>(frames.Size()));
        if (frames.GetAt(selectedIndex).ValueType() == JsonValueType::Object) {
          const JsonObject frame = frames.GetAt(selectedIndex).GetObject();
          validAt = static_cast<int64_t>(std::max(0.0, json::Number(frame, L"validAt")));
          std::vector<RadarTile> forecastTiles;
          bool forecastComplete = true;
          for (uint32_t frameIndex = 0; frameIndex < frames.Size(); ++frameIndex) {
            if (frames.GetAt(frameIndex).ValueType() != JsonValueType::Object) {
              forecastComplete = false;
              continue;
            }
            const JsonObject candidateFrame = frames.GetAt(frameIndex).GetObject();
            const JsonArray candidateTiles = json::Array(candidateFrame, L"tiles");
            std::set<std::pair<LONG, LONG>> frameDestinations;
            if (candidateTiles.Size() == 0) forecastComplete = false;
            for (uint32_t tileIndex = 0; tileIndex < candidateTiles.Size(); ++tileIndex) {
              if (candidateTiles.GetAt(tileIndex).ValueType() != JsonValueType::Object) {
                forecastComplete = false;
                continue;
              }
              const JsonObject tile = candidateTiles.GetAt(tileIndex).GetObject();
              const std::wstring url = json::Text(tile, L"url");
              const POINT destination{
                  static_cast<LONG>(json::Number(tile, L"destX")),
                  static_cast<LONG>(json::Number(tile, L"destY")),
              };
              if (!frameDestinations.emplace(destination.x, destination.y).second) {
                forecastComplete = false;
              }
              const std::optional<fs::path> tilePath = RadarTilePath(dataDir_, url);
              const std::string tileStamp = tilePath ? file::Stamp(*tilePath) : "invalid";
              if (url.empty() || !tilePath || tileStamp == "missing") forecastComplete = false;
              RadarTile parsed{
                  url, destination, tilePath.value_or(fs::path{}), tileStamp};
              forecastTiles.push_back(parsed);
              if (frameIndex == selectedIndex) tiles.push_back(std::move(parsed));
            }
            if (!RadarTileLayoutCoversSource(
                    frameDestinations, sourceWidth, sourceHeight)) {
              forecastComplete = false;
            }
          }
          noRainForecast = !precomposed && forecastComplete &&
              RadarForecastHasNoRain(forecastTiles, sourceWidth, sourceHeight);
          animationIntervalMs = frames.Size() > 1 ? frameIntervalMs : 0;
          if (noRainForecast) animationIntervalMs = 0;

          std::wostringstream signatureStream;
          signatureStream << L"native-radar-v10|" << kRadarCanvasWidth << L'x' << kRadarCanvasHeight
                          << L"|source:" << sourceWidth << L'x' << sourceHeight
                          << L"|precomposed:" << (precomposed ? 1 : 0)
                          << L"|no-rain:" << (noRainForecast ? 1 : 0)
                          << L"|animate:" << animationIntervalMs
                          << L"|frame:" << selectedIndex << L'/' << frames.Size()
                          << L"|" << json::Text(frame, L"baseTime")
                          << L"|" << json::Text(frame, L"validTime")
                          << L"|" << validAt;
          if (!precomposed) {
            signatureStream << L"|sat:" << Utf8ToWide(satelliteStamp)
                            << L"|map:" << Utf8ToWide(mapStamp);
          }
          signatureStream << L"|tiles:" << tiles.size();
          for (const RadarTile& tile : tiles) {
            signatureStream << L"|" << tile.url << L"@" << tile.destination.x << L","
                            << tile.destination.y << L"#" << Utf8ToWide(tile.fileStamp);
          }
          signature = signatureStream.str();
        }
      }
    } catch (...) {
      tiles.clear();
      signature.clear();
      validAt = 0;
      animationIntervalMs = 0;
      precomposed = false;
      noRainForecast = false;
    }
  }

  {
    std::lock_guard lock(radarFrameMutex_);
    if (!signature.empty() && signature == radarSignature_ && radarFrameBitmap_) return;
  }

  const std::string signatureUtf8 = WideToUtf8(signature);
  const fs::path cachedFrame = dataDir_ / L"radar-frame.bmp";
  const fs::path cachedSignature = dataDir_ / L"radar-frame.signature";
  if (animationIntervalMs == 0 && !signature.empty() &&
      file::MatchesText(cachedSignature, signatureUtf8)) {
    HBITMAP cached = DecodeImageFileToBitmap(cachedFrame, kRadarCanvasWidth, kRadarCanvasHeight);
    if (cached) {
      std::wstring timeText = noRainForecast ? kNoRainMessage : RadarTimeFromMillis(validAt);
      if (timeText.empty()) timeText = tiles.empty() ? L"待機中" : L"--:--";
      HBITMAP previousFrame = nullptr;
      {
        std::lock_guard lock(radarFrameMutex_);
        if (signature == radarSignature_ && radarFrameBitmap_) {
          DeleteObject(cached);
          return;
        }
        previousFrame = radarFrameBitmap_;
        radarFrameBitmap_ = cached;
        radarTimeText_ = std::move(timeText);
        radarSignature_ = signature;
      }
      if (previousFrame) DeleteObject(previousFrame);
      InvalidateRadarWindow(nativeRadarWindow_);
      return;
    }
  }

  if (precomposed &&
      (tiles.size() != 1 || tiles.front().destination.x != 0 || tiles.front().destination.y != 0)) {
    return;
  }

  HBITMAP radarSatelliteBitmap = nullptr;
  HBITMAP radarMapBitmap = nullptr;
  if (!precomposed) {
    radarSatelliteBitmap = CachedRadarBitmap(
        L"radar-satellite", satellitePath, satelliteStamp,
        kRadarCanvasWidth, kRadarCanvasHeight);
    radarMapBitmap = CachedRadarBitmap(
        L"radar-map", mapPath, mapStamp, kRadarCanvasWidth, kRadarCanvasHeight);
    if (!radarSatelliteBitmap || !radarMapBitmap) return;
  }

  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(info.bmiHeader);
  info.bmiHeader.biWidth = kRadarCanvasWidth;
  info.bmiHeader.biHeight = -kRadarCanvasHeight;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  void* pixels = nullptr;
  RadarCompositionSurface surface;
  if (!surface.Initialize(info, &pixels)) return;
  HDC composeDc = surface.dc;
  if (precomposed) {
    PatBlt(composeDc, 0, 0, kRadarCanvasWidth, kRadarCanvasHeight, BLACKNESS);
  } else {
    BlendBitmap(composeDc, radarSatelliteBitmap, 0, 0, kRadarCanvasWidth, kRadarCanvasHeight);
  }

  const double scaleX = static_cast<double>(kRadarCanvasWidth) / sourceWidth;
  const double scaleY = static_cast<double>(kRadarCanvasHeight) / sourceHeight;
  const int tileWidth = static_cast<int>(std::ceil(256 * scaleX));
  const int tileHeight = static_cast<int>(std::ceil(256 * scaleY));
  size_t loadedTiles = 0;
  const int64_t now = UnixMillis();
  std::erase_if(radarFailedTiles_, [now](const auto& item) { return item.second <= now; });
  for (const RadarTile& tile : tiles) {
    if (radarComposeStopping_.load(std::memory_order_acquire)) break;
    if (TileFailureActive(radarFailedTiles_, tile.url, now)) continue;
    HBITMAP tileBitmap = tile.path.empty()
        ? nullptr
        : CachedRadarBitmap(L"radar-tile:" + tile.url, tile.path,
                            tile.fileStamp, tileWidth, tileHeight);
    if (!tileBitmap) {
      radarFailedTiles_[tile.url] = now + kRadarTileFailureTtlMs;
      continue;
    }
    BlendBitmap(composeDc, tileBitmap,
                static_cast<int>(std::lround(tile.destination.x * scaleX)),
                static_cast<int>(std::lround(tile.destination.y * scaleY)),
                tileWidth, tileHeight);
    ++loadedTiles;
  }

  if (!precomposed) {
    BlendBitmap(composeDc, radarMapBitmap, 0, 0, kRadarCanvasWidth, kRadarCanvasHeight);
  }

  if (!tiles.empty() && loadedTiles == 0) return;

  std::wstring timeText = noRainForecast ? kNoRainMessage : RadarTimeFromMillis(validAt);
  if (timeText.empty()) timeText = tiles.empty() ? L"待機中" : L"--:--";

  // A bitmap passed to GetDIBits must not remain selected into a memory DC.
  surface.FinishDrawing();

  // Persist only static radar frames. Serializing the 1920x1280 bitmap for every
  // animation step allocates and writes roughly 10 MB without improving restart
  // recovery because the selected frame changes again on the next interval.
  if (animationIntervalMs == 0 && !signature.empty() &&
      SaveBitmapAsBmp(surface.bitmap, cachedFrame, kRadarCanvasWidth, kRadarCanvasHeight)) {
    AtomicWriteText(cachedSignature, signatureUtf8);
  }

  HBITMAP composed = surface.Release();
  HBITMAP previousFrame = nullptr;
  {
    std::lock_guard lock(radarFrameMutex_);
    previousFrame = radarFrameBitmap_;
    radarFrameBitmap_ = composed;
    radarTimeText_ = std::move(timeText);
    radarSignature_ = signature;
  }
  if (previousFrame) DeleteObject(previousFrame);
  InvalidateRadarWindow(nativeRadarWindow_);
}
}  // namespace hp
