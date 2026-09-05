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
  void SetPodcastMode(bool podcastWindowActive) noexcept;
  static void CALLBACK StaggeredReconcileTimerProc(
      HWND hwnd, UINT message, UINT_PTR timerId, DWORD tickCount);

 private:
  static constexpr size_t kAccountCount = 6;

  struct Slot {
    SpotifyWebViews* owner = nullptr;
    size_t index = 0;
    HWND hostWindow = nullptr;
    ComPtr<ICoreWebView2Environment> environment;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;
    EventRegistrationToken navigationStartingToken{};
    EventRegistrationToken navigationCompletedToken{};
    EventRegistrationToken webMessageReceivedToken{};
    EventRegistrationToken webResourceRequestedToken{};
    ULONGLONG lastModeNavigateTick = 0;
    ULONGLONG controllerCreateTick = 0;
    int unhealthyChecks = 0;
    bool controllerCreating = false;
    bool reconcileInFlight = false;
    bool playing = false;
    bool playerPage = false;
    bool podcastCompleted = false;
  };

  static LRESULT CALLBACK HostWndProc(
      HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);
  static void CALLBACK ReconcileTimerProc(
      HWND hwnd, UINT message, UINT_PTR timerId, DWORD tickCount);
  static bool IsSpotifyPlayerUri(const wchar_t* uri) noexcept;
  static bool ParseNormalizedPoint(LPCWSTR json, int* x, int* y) noexcept;
  static HDWP DeferSpotifyHostWindowPos(
      HDWP batch, HWND hwnd, HWND insertAfter, int x, int y,
      int width, int height, UINT flags) noexcept;
  static BOOL SetSpotifyHostWindowPos(
      HWND hwnd, HWND insertAfter, int x, int y,
      int width, int height, UINT flags) noexcept;

  bool EnsureHostClass() noexcept;
  bool CreateHost(Slot& slot) noexcept;
  void CreateController(Slot& slot) noexcept;
  void Configure(Slot& slot) noexcept;
  void ArmModeTimer() noexcept;
  void ArmPlaybackWatchdog() noexcept;
  void RunPlaybackWatchdog() noexcept;
  void ToggleMode() noexcept;
  void NavigateSlotToCurrentMode(Slot& slot) noexcept;
  void StopLegacySchedulers() noexcept;
  void ArmRobustScheduler() noexcept;
  void ReconcileDesiredMode() noexcept;
  void BeginControllerCreate(Slot& slot) noexcept;
  bool SlotWantsPodcast(const Slot& slot) const noexcept;
  bool SlotMatchesDesiredMode(const Slot& slot) const noexcept;
  bool SlotIsLoginPage(const Slot& slot) const noexcept;
  void NavigateSlotRobustly(Slot& slot) noexcept;
  void ClickSlotNormalizedPoint(Slot& slot, int xTenThousandths,
                                int yTenThousandths) noexcept;
  UINT DispatchSpotifyDevToolsClick(Slot& slot, int xTenThousandths,
                                    int yTenThousandths) noexcept;
  const wchar_t* RewriteSpotifyPhaseExecuteScript(const wchar_t* script) noexcept;
  void RefreshSpotifyHostLayout() noexcept;
  void RecomputeForegroundAndRefreshSpotifyHostLayout() noexcept;
  void SetForeground(bool foreground) noexcept;
  void RecomputeForeground() noexcept;
  void PlaceHosts(bool foreground) noexcept;
  void CloseSlot(Slot& slot) noexcept;
  void SetPodcastModeImmediate(bool podcastWindowActive) noexcept;
  void RunStaggeredReconcile() noexcept;

  HWND parentWindow_ = nullptr;
  fs::path userDataFolder_;
  std::array<Slot, kAccountCount> slots_{};
  std::shared_ptr<std::atomic<bool>> alive_ =
      std::make_shared<std::atomic<bool>>(true);
  size_t playbackWatchdogIndex_ = 0;
  size_t reconcileIndex_ = 0;
  size_t staggerSlotIndex_ = 0;
  ULONGLONG staggerSlotStartTick_ = 0;
  bool staggerSlotValidated_ = false;
  unsigned hostLayoutMask_ = ~0u;
  size_t hostLayoutActiveSlot_ = kAccountCount;
  bool started_ = false;
  bool foreground_ = true;
  bool podcastMode_ = false;
  bool robustSchedulerStarted_ = false;
};

// tverPhase=false means the one-hour YouTube window has started: play one
// TALKABOUT episode, then fall back to Lonesome rabbit. tverPhase=true starts
// the one-hour TVer window; Spotify slots transition serially at 10-minute
// offsets so all six WebViews are never recovered at the same time.
void SetSpotifyMediaPhase(bool tverPhase) noexcept;

}  // namespace hp
