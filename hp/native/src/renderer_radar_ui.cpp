#include "web_renderer.h"
#include "file_utils.h"
#include "wic_image.h"
#include "json_helpers.h"
#include <winrt/Windows.Data.Json.h>

namespace hp {
namespace {
using winrt::Windows::Data::Json::JsonArray;
using winrt::Windows::Data::Json::JsonObject;
using winrt::Windows::Data::Json::JsonValueType;

constexpr wchar_t kRepresentativeRadarPath[] =
    L"/v1/radar/frame/representative/latest.png";
constexpr wchar_t kLocalizedRadarPrefix[] = L"https://data.homepanel/";

struct ScopedRadarComApartment {
  HRESULT result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  ~ScopedRadarComApartment() {
    if (SUCCEEDED(result)) CoUninitialize();
  }
};

fs::path RepresentativeRadarLocalPath(const fs::path& dataDir) {
  return dataDir / L"v1" / L"radar" / L"frame" / L"representative" /
         L"latest.png";
}

std::optional<fs::path> RepresentativeRadarFramePath(
    const fs::path& dataDir, const JsonObject& root) noexcept {
  try {
    if (!json::Boolean(root, L"precomposed")) return std::nullopt;
    const int width = static_cast<int>(json::Number(root, L"width"));
    const int height = static_cast<int>(json::Number(root, L"height"));
    if (width != kRadarCanvasWidth || height != kRadarCanvasHeight) {
      return std::nullopt;
    }

    const JsonArray frames = json::Array(root, L"frames");
    if (frames.Size() != 1 ||
        frames.GetAt(0).ValueType() != JsonValueType::Object) {
      return std::nullopt;
    }
    const JsonObject frame = frames.GetAt(0).GetObject();
    const JsonArray tiles = json::Array(frame, L"tiles");
    if (tiles.Size() != 1 ||
        tiles.GetAt(0).ValueType() != JsonValueType::Object) {
      return std::nullopt;
    }
    const JsonObject tile = tiles.GetAt(0).GetObject();
    if (static_cast<LONG>(json::Number(tile, L"destX")) != 0 ||
        static_cast<LONG>(json::Number(tile, L"destY")) != 0) {
      return std::nullopt;
    }

    const std::wstring url = json::Text(tile, L"url");
    if (!url.starts_with(kLocalizedRadarPrefix) ||
        url.find(kRepresentativeRadarPath) == std::wstring::npos) {
      return std::nullopt;
    }
    std::wstring relative = url.substr(std::size(kLocalizedRadarPrefix) - 1);
    if (relative.empty() || relative.find(L"..") != std::wstring::npos) {
      return std::nullopt;
    }
    for (wchar_t& character : relative) {
      if (character == L'/') character = L'\\';
    }
    return (dataDir / relative).lexically_normal();
  } catch (...) {
    return std::nullopt;
  }
}

std::wstring RepresentativeRadarSignature(
    const fs::path& path, const std::string& stamp) {
  return std::wstring(L"native-radar-single-v2|") +
         std::to_wstring(kRadarCanvasWidth) + L"x" +
         std::to_wstring(kRadarCanvasHeight) + L"|" + path.wstring() + L"|" +
         Utf8ToWide(stamp);
}

bool InvalidStamp(const std::string& stamp) {
  return stamp.empty() || stamp == "missing" || stamp == "invalid";
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
        OutputDebugStringW(
            L"HomePanel radar compose thread recovered from an exception\n");
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
    {
      std::unique_lock waitLock(radarComposeWakeMutex_);
      radarComposeWake_.wait(waitLock, [this] {
        return radarComposePending_ ||
               radarComposeStopping_.load(std::memory_order_acquire);
      });
      if (radarComposeStopping_.load(std::memory_order_acquire)) break;
      radarComposePending_ = false;
    }
    ComposeRadarFrame();
  }
}

void Renderer::ComposeRadarFrame() {
  const fs::path radarJsonPath = dataDir_ / L"radar.json";
  const std::string jsonStamp = file::Stamp(radarJsonPath);
  if (InvalidStamp(jsonStamp)) return;

  bool jsonUnchanged = false;
  {
    std::lock_guard lock(radarFrameMutex_);
    jsonUnchanged = radarFrameBitmap_ && radarJsonStamp_ == jsonStamp;
  }

  std::optional<fs::path> framePath;
  if (jsonUnchanged) {
    framePath = RepresentativeRadarLocalPath(dataDir_);
  } else {
    JsonObject root;
    try {
      std::ifstream input(radarJsonPath, std::ios::binary);
      if (!input) return;
      const std::string text((std::istreambuf_iterator<char>(input)), {});
      if (text.empty()) return;
      root = JsonObject::Parse(Utf8ToWide(text));
    } catch (...) {
      return;
    }
    framePath = RepresentativeRadarFramePath(dataDir_, root);
    if (!framePath) return;
  }

  const std::string stamp = file::Stamp(*framePath);
  if (InvalidStamp(stamp)) return;
  const std::wstring signature = RepresentativeRadarSignature(*framePath, stamp);

  {
    std::lock_guard lock(radarFrameMutex_);
    if (radarFrameBitmap_ && radarSignature_ == signature) {
      radarJsonStamp_ = jsonStamp;
      return;
    }
  }

  HBITMAP decoded = DecodeImageFileToBitmap(
      *framePath, kRadarCanvasWidth, kRadarCanvasHeight);
  if (!decoded) return;

  HBITMAP previous = nullptr;
  {
    std::lock_guard lock(radarFrameMutex_);
    if (radarFrameBitmap_ && radarSignature_ == signature) {
      radarJsonStamp_ = jsonStamp;
      DeleteObject(decoded);
      return;
    }
    previous = radarFrameBitmap_;
    radarFrameBitmap_ = decoded;
    radarTimeText_.clear();
    radarSignature_ = signature;
    radarJsonStamp_ = jsonStamp;
  }
  if (previous) DeleteObject(previous);
  InvalidatePanelSection(nativeMainWindow_, PanelSection::Radar);
}
}  // namespace hp
