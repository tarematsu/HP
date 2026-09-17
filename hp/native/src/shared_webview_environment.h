#pragma once
#include "common.h"

namespace hp {
class SharedWebViewEnvironment {
 public:
  using Completion = std::function<void(HRESULT, ICoreWebView2Environment*)>;

  static SharedWebViewEnvironment& Instance();
  // Stationhead, Spotify, YouTube and TVer reuse one WebView2 user-data folder.
  // The shared environment disables image loading/decoding and downloadable
  // web fonts for every profile in that UDF while preserving media/DRM paths.
  void Acquire(const fs::path& userDataFolder, Completion completion) {
    Acquire(userDataFolder, true, true, std::move(completion));
  }
  void Acquire(const fs::path& userDataFolder, bool blockImages,
               bool blockFonts, Completion completion);
  // A single invalidation of a ready environment remains non-destructive. If
  // controller creation repeatedly fails against the same cached environment,
  // Invalidate escalates to a shared browser-process restart so every playback
  // surface reconnects to a fresh Audio Service/browser environment.
  void Invalidate(const fs::path& userDataFolder);

 private:
  struct Entry {
    fs::path userDataFolder;
    ComPtr<ICoreWebView2Environment> environment;
    std::vector<Completion> pending;
    uint32_t acquireCount = 0;
    uint32_t readyInvalidationStrikes = 0;
    uint64_t generation = 0;
    uint64_t firstReadyInvalidationTick = 0;
    uint64_t lastHardResetTick = 0;
    bool creating = false;
    bool blockImages = false;
    bool blockFonts = false;
  };

  SharedWebViewEnvironment() = default;
  void Complete(const std::wstring& key, uint64_t generation, HRESULT result,
                ICoreWebView2Environment* environment);
  static std::wstring NormalizePath(const fs::path& path);

  std::mutex mutex_;
  std::map<std::wstring, Entry> entries_;
};
}  // namespace hp
