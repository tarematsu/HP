#pragma once
#include "common.h"

namespace hp {

class SpotifyWebViews final {
 public:
  SpotifyWebViews(HWND parentWindow, fs::path dataDir);
  ~SpotifyWebViews();

  SpotifyWebViews(const SpotifyWebViews&) = delete;
  SpotifyWebViews& operator=(const SpotifyWebViews&) = delete;

  void Start() noexcept;
  void Resize() noexcept;
  void Shutdown() noexcept;

 private:
  static constexpr size_t kAccountCount = 6;

  struct Slot {
    SpotifyWebViews* owner = nullptr;
    size_t index = 0;
    HWND hostWindow = nullptr;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;
    EventRegistrationToken navigationStartingToken{};
    EventRegistrationToken navigationCompletedToken{};
    EventRegistrationToken webMessageReceivedToken{};
    bool authNavigation = false;
    bool playing = false;
  };

  static LRESULT CALLBACK HostWndProc(
      HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);
  static bool IsSpotifyAuthUri(const wchar_t* uri) noexcept;
  static bool IsSpotifyPlayerUri(const wchar_t* uri) noexcept;

  bool EnsureHostClass() noexcept;
  bool CreateHost(Slot& slot) noexcept;
  void CreateController(Slot& slot) noexcept;
  void Configure(Slot& slot) noexcept;
  void SetForeground(bool foreground) noexcept;
  void RecomputeForeground() noexcept;
  void PlaceHosts(bool foreground) noexcept;
  void CloseSlot(Slot& slot) noexcept;

  HWND parentWindow_ = nullptr;
  fs::path userDataFolder_;
  std::array<Slot, kAccountCount> slots_{};
  std::shared_ptr<std::atomic<bool>> alive_ =
      std::make_shared<std::atomic<bool>>(true);
  bool started_ = false;
  bool foreground_ = true;
};

}  // namespace hp
