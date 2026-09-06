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

  enum class TimedSpotifyTarget : unsigned char {
    None,
    BitterBlue,
    TalkAbout,
    LonesomeRabbit,
    CatalogTrack,
  };

  static constexpr size_t kNoTimedCatalogIndex = static_cast<size_t>(-1);

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
    EventRegistrationToken timedEndMessageReceivedToken{};
    ICoreWebView2* timedEndHandlerWebview = nullptr;
    ULONGLONG lastModeNavigateTick = 0;
    ULONGLONG controllerCreateTick = 0;
    ULONGLONG lastTimedRotationWave = ~0ULL;
    ULONGLONG timedRotationCycle = 0;
    ULONGLONG timedStepStartTick = 0;
    ULONGLONG timedCompletionPendingTick = 0;
    ULONGLONG lastTimedReconcileTick = 0;
    size_t timedCatalogIndex = kNoTimedCatalogIndex;
    size_t timedRandomCIndex = kNoTimedCatalogIndex;
    size_t timedRandomDIndex = kNoTimedCatalogIndex;
    int unhealthyChecks = 0;
    unsigned char timedRotationPosition = 0;
    bool controllerCreating = false;
    bool reconcileInFlight = false;
    bool playing = false;
    bool playerPage = false;
    bool podcastCompleted = false;
    bool timedRotationActive = false;
    bool timedPreludeCompleted = false;
    bool timedBridgeCompleted = false;
    TimedSpotifyTarget timedTarget = TimedSpotifyTarget::None;
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
  bool SlotMatchesTimedTarget(const Slot& slot) const noexcept;
  void NavigateTimedSlot(Slot& slot) noexcept;
  void ReconcileTimedSlot(Slot& slot) noexcept;
  size_t PickTimedRandomCatalogIndex(size_t avoidIndex) noexcept;
  void EnsureTimedRandomPair(ULONGLONG rotationCycle) noexcept;
  size_t PickRecentCatalogIndex(size_t avoidIndex,
                                size_t secondAvoidIndex) noexcept;
  void EnsureRecentRandomPair(ULONGLONG rotationCycle,
                              size_t avoidIndex) noexcept;
  bool SlotMatchesRecentTimedTarget(const Slot& slot) const noexcept;
  void NavigateRecentTimedSlot(Slot& slot) noexcept;
  void ReconcileRecentTimedSlot(Slot& slot) noexcept;
  void NavigateActiveTimedSlot(Slot& slot) noexcept;
  void ReconcileActiveTimedSlot(Slot& slot) noexcept;
  void ApplyTimedRotationTarget(Slot& slot) noexcept;
  void InitializeTimedRotationSlot(Slot& slot, ULONGLONG now) noexcept;
  void AdvanceTimedRotationSlot(Slot& slot, ULONGLONG now) noexcept;
  void ArmTimedEndObserver(Slot& slot) noexcept;
  void StopTimedOneShotPlayback(Slot& slot) noexcept;
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
  ULONGLONG youtubeCycleStartTick_ = 0;
  ULONGLONG timedRandomState_ = 0;
  ULONGLONG timedRandomPairCycle_ = ~0ULL;
  size_t timedBridgeCatalogIndex_ = kNoTimedCatalogIndex;
  size_t timedRandomCIndex_ = kNoTimedCatalogIndex;
  size_t timedRandomDIndex_ = kNoTimedCatalogIndex;
  bool staggerSlotValidated_ = false;
  unsigned hostLayoutMask_ = ~0u;
  size_t hostLayoutActiveSlot_ = kAccountCount;
  bool hostLayoutAuthenticationVisible_ = false;
  bool started_ = false;
  bool foreground_ = true;
  bool podcastMode_ = false;
  bool robustSchedulerStarted_ = false;
};

// tverPhase=false starts the YouTube-hour schedule: BitterBlue at 00:00,
// TALKABOUT at 04:00, one recent-song bridge, then from 20:00 the completion-
// driven Lonesome rabbit -> random B -> BitterBlue -> random D rotation.
// The six accounts keep their initial 40-second offsets. After startup, only one
// WebView at a time gets a recovery-sized viewport and the owner rotates every
// 15 seconds. There is no parallel background stall scanner. Track completion is
// event-driven; an ambiguous ad/end state waits and retries the same target rather
// than skipping it. TVer does not reset an already-running rotation.
void SetSpotifyMediaPhase(bool tverPhase) noexcept;

}  // namespace hp
