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
  void Invalidate(const fs::path& userDataFolder);

  // Final recovery for a shared browser process whose media services remain
  // unhealthy after per-surface recovery. BrowserProcessExited is observed
  // before the cached environment becomes reusable, preventing two environments
  // from racing against the same user-data folder.
  bool RecycleBrowserProcess(const fs::path& userDataFolder,
                             ICoreWebView2* webview) noexcept;

 private:
  struct Entry {
    fs::path userDataFolder;
    ComPtr<ICoreWebView2Environment> environment;
    std::vector<Completion> pending;
    EventRegistrationToken browserProcessExitedToken{};
    uint32_t acquireCount = 0;
    uint64_t generation = 0;
    ULONGLONG recycleStartedTick = 0;
    ULONGLONG lastRecycleTick = 0;
    bool creating = false;
    bool recyclePending = false;
    bool blockImages = false;
    bool blockFonts = false;
  };

  SharedWebViewEnvironment() = default;
  void Complete(const std::wstring& key, uint64_t generation, HRESULT result,
                ICoreWebView2Environment* environment);
  void HandleBrowserProcessExited(const std::wstring& key,
                                  uint64_t environmentGeneration) noexcept;
  static std::wstring NormalizePath(const fs::path& path);

  std::mutex mutex_;
  std::map<std::wstring, Entry> entries_;
};
}  // namespace hp
