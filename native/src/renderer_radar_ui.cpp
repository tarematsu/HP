#include "web_renderer.h"
#include "artwork_cache.h"
#include "wic_image.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
constexpr size_t kMaxRadarTileBytes = 8 * 1024 * 1024;
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

JsonArray RadarChildArray(const JsonObject& parent, const wchar_t* name) {
  try {
    if (parent.HasKey(name) &&
        parent.GetNamedValue(name).ValueType() == JsonValueType::Array) {
      return parent.GetNamedArray(name);
    }
  } catch (...) {
  }
  return JsonArray{};
}

std::wstring RadarText(const JsonObject& object, const wchar_t* name) {
  try {
    if (object.HasKey(name) &&
        object.GetNamedValue(name).ValueType() == JsonValueType::String) {
      return object.GetNamedString(name).c_str();
    }
  } catch (...) {
  }
  return {};
}

double RadarNumber(const JsonObject& object, const wchar_t* name, double fallback = 0) {
  try {
    if (object.HasKey(name) &&
        object.GetNamedValue(name).ValueType() == JsonValueType::Number) {
      return object.GetNamedNumber(name);
    }
  } catch (...) {
  }
  return fallback;
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

HBITMAP DecodeRadarTile(const fs::path& dataDir, const std::wstring& url,
                        int width, int height) {
  static constexpr wchar_t kDataHostPrefix[] = L"https://data.homepanel/";
  if (url.empty()) return nullptr;
  if (url.rfind(kDataHostPrefix, 0) == 0) {
    std::wstring relative = url.substr(std::size(kDataHostPrefix) - 1);
    if (relative.empty() || relative.find(L"..") != std::wstring::npos) return nullptr;
    for (auto& character : relative) {
      if (character == L'/') character = L'\\';
    }
    return DecodeImageFileToBitmap(dataDir / relative, width, height);
  }
  if (url.rfind(L"https://", 0) != 0 && url.rfind(L"http://", 0) != 0) return nullptr;
  std::vector<uint8_t> bytes;
  if (!DownloadUrlBytes(url.c_str(), kMaxRadarTileBytes, &bytes, nullptr,
                        L"HomePanel-Radar/1.0")) {
    return nullptr;
  }
  return DecodeImageBytesToBitmap(bytes.data(), bytes.size(), width, height);
}

void BlendBitmap(HDC dc, HBITMAP bitmap, int left, int top, int width, int height) {
  if (!bitmap || width <= 0 || height <= 0) return;
  HDC sourceDc = CreateCompatibleDC(dc);
  if (!sourceDc) return;
  HGDIOBJ previous = SelectObject(sourceDc, bitmap);
  const BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  AlphaBlend(dc, left, top, width, height, sourceDc, 0, 0, width, height, blend);
  SelectObject(sourceDc, previous);
  DeleteDC(sourceDc);
}
}  // namespace

void Renderer::StartRadarCompose() {
  if (radarComposeStarted_.exchange(true, std::memory_order_acq_rel)) return;
  radarComposeStopping_ = false;
  {
    std::lock_guard lock(radarComposeWakeMutex_);
    radarComposePending_ = true;
  }
  radarComposeThread_ = std::thread([this] { RadarComposeLoop(); });
}

void Renderer::StopRadarCompose() noexcept {
  if (!radarComposeStarted_.exchange(false, std::memory_order_acq_rel)) return;
  radarComposeStopping_ = true;
  radarComposeWake_.notify_all();
  if (radarComposeThread_.joinable()) radarComposeThread_.join();
  if (radarSatelliteBitmap_) DeleteObject(radarSatelliteBitmap_);
  if (radarMapBitmap_) DeleteObject(radarMapBitmap_);
  radarSatelliteBitmap_ = nullptr;
  radarMapBitmap_ = nullptr;
}

void Renderer::RadarComposeLoop() {
  while (!radarComposeStopping_.load(std::memory_order_acquire)) {
    {
      std::unique_lock waitLock(radarComposeWakeMutex_);
      radarComposeWake_.wait(waitLock, [this] {
        return radarComposePending_ ||
               radarComposeStopping_.load(std::memory_order_acquire);
      });
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

  int sourceWidth = 400;
  int sourceHeight = 260;
  int64_t validAt = 0;
  std::wstring signature;
  std::vector<std::pair<std::wstring, POINT>> tiles;
  if (!json.empty()) {
    try {
      const JsonObject root = JsonObject::Parse(json);
      sourceWidth = std::max(1, static_cast<int>(RadarNumber(root, L"width", 400)));
      sourceHeight = std::max(1, static_cast<int>(RadarNumber(root, L"height", 260)));
      const JsonArray frames = RadarChildArray(root, L"frames");
      if (frames.Size() > 0 && frames.GetAt(0).ValueType() == JsonValueType::Object) {
        const JsonObject frame = frames.GetAt(0).GetObject();
        validAt = static_cast<int64_t>(std::max(0.0, RadarNumber(frame, L"validAt")));
        const JsonArray frameTiles = RadarChildArray(frame, L"tiles");
        signature = RadarText(frame, L"baseTime") + L"|" + RadarText(frame, L"validTime") +
            L"|" + std::to_wstring(frameTiles.Size());
        for (uint32_t index = 0; index < frameTiles.Size(); ++index) {
          if (frameTiles.GetAt(index).ValueType() != JsonValueType::Object) continue;
          const JsonObject tile = frameTiles.GetAt(index).GetObject();
          const std::wstring url = RadarText(tile, L"url");
          const POINT destination{
              static_cast<LONG>(RadarNumber(tile, L"destX")),
              static_cast<LONG>(RadarNumber(tile, L"destY")),
          };
          tiles.emplace_back(url, destination);
          signature += L"|" + url;
        }
      }
    } catch (...) {
      tiles.clear();
      signature.clear();
      validAt = 0;
    }
  }

  {
    std::lock_guard lock(radarFrameMutex_);
    if (!signature.empty() && signature == radarSignature_ && radarFrameBitmap_) return;
  }

  if (!radarSatelliteBitmap_) {
    radarSatelliteBitmap_ = DecodeImageFileToBitmap(
        uiDir_ / L"radar-satellite.png", kRadarCanvasWidth, kRadarCanvasHeight);
  }
  if (!radarMapBitmap_) {
    radarMapBitmap_ = DecodeImageFileToBitmap(
        uiDir_ / L"radar-map.png", kRadarCanvasWidth, kRadarCanvasHeight);
  }
  if (!radarSatelliteBitmap_ || !radarMapBitmap_) return;

  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(info.bmiHeader);
  info.bmiHeader.biWidth = kRadarCanvasWidth;
  info.bmiHeader.biHeight = -kRadarCanvasHeight;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  void* pixels = nullptr;
  HBITMAP composed = CreateDIBSection(nullptr, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
  if (!composed) return;

  HDC composeDc = CreateCompatibleDC(nullptr);
  if (!composeDc) {
    DeleteObject(composed);
    return;
  }
  HGDIOBJ previousComposed = SelectObject(composeDc, composed);

  BlendBitmap(composeDc, radarSatelliteBitmap_, 0, 0, kRadarCanvasWidth, kRadarCanvasHeight);

  const double scaleX = static_cast<double>(kRadarCanvasWidth) / sourceWidth;
  const double scaleY = static_cast<double>(kRadarCanvasHeight) / sourceHeight;
  const int tileWidth = static_cast<int>(std::ceil(256 * scaleX));
  const int tileHeight = static_cast<int>(std::ceil(256 * scaleY));
  size_t loadedTiles = 0;
  for (const auto& [url, destination] : tiles) {
    if (radarComposeStopping_.load(std::memory_order_acquire)) break;
    HBITMAP tileBitmap = DecodeRadarTile(dataDir_, url, tileWidth, tileHeight);
    if (!tileBitmap) continue;
    BlendBitmap(composeDc, tileBitmap,
                static_cast<int>(std::lround(destination.x * scaleX)),
                static_cast<int>(std::lround(destination.y * scaleY)),
                tileWidth, tileHeight);
    DeleteObject(tileBitmap);
    ++loadedTiles;
  }

  BlendBitmap(composeDc, radarMapBitmap_, 0, 0, kRadarCanvasWidth, kRadarCanvasHeight);
  SelectObject(composeDc, previousComposed);
  DeleteDC(composeDc);

  if (!tiles.empty() && loadedTiles == 0) {
    // Keep the last successfully rendered frame when every tile fails.
    DeleteObject(composed);
    return;
  }

  std::wstring timeText = RadarTimeFromMillis(validAt);
  if (timeText.empty()) timeText = tiles.empty() ? L"待機中" : L"--:--";

  HBITMAP previousFrame = nullptr;
  {
    std::lock_guard lock(radarFrameMutex_);
    previousFrame = radarFrameBitmap_;
    radarFrameBitmap_ = composed;
    radarTimeText_ = std::move(timeText);
    radarSignature_ = signature;
  }
  if (previousFrame) DeleteObject(previousFrame);

  const HWND radarWindow = nativeRadarWindow_;
  if (radarWindow && IsWindow(radarWindow)) InvalidateRect(radarWindow, nullptr, FALSE);
}
}  // namespace hp
