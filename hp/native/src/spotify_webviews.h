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
  void SetNetworkBlocked(bool blocked) noexcept;
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
    ULONGLONG timedRotationCycle = 0;
    ULONGLONG timedCompletionPendingTick = 0;
    ULONGLONG timedPlaybackStartTick = 0;
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
  static bool IsSpotifyPlayerUri(const wchar_t* uri) noexcept;
  static bool ParseNormalizedPoint(LPCWSTR json, int* x, int* y) noexcept;

  bool EnsureHostClass() noexcept;
  bool CreateHost(Slot& slot) noexcept;
  void CreateController(Slot& slot) noexcept;
  void Configure(Slot& slot) noexcept;
  void ArmRobustScheduler() noexcept;
  void BeginControllerCreate(Slot& slot) noexcept;
  bool SlotIsLoginPage(const Slot& slot) const noexcept;
  void ClickSlotNormalizedPoint(Slot& slot, int xTenThousandths,
                                int yTenThousandths) noexcept;
  UINT DispatchSpotifyDevToolsClick(Slot& slot, int xTenThousandths,
                                    int yTenThousandths) noexcept;
  void PostSpotifyPageContext(Slot& slot) noexcept;
  void PostSpotifyTargetDescriptorForSlot(Slot& slot) noexcept;
  void RefreshSpotifyHostLayout() noexcept;
  bool SlotMatchesTimedTarget(const Slot& slot) const noexcept;
  void NavigateTimedSlot(Slot& slot) noexcept;
  void ReconcileTimedSlot(Slot& slot) noexcept;
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
  bool AdvanceExpiredTimedRotation(ULONGLONG now) noexcept;
  void ArmTimedEndObserver(Slot& slot) noexcept;
  void StopTimedOneShotPlayback(Slot& slot) noexcept;
  void RecomputeForeground() noexcept;
  void PlaceHosts() noexcept;
  void CloseSlot(Slot& slot) noexcept;
  void RunStaggeredReconcile() noexcept;

  HWND parentWindow_ = nullptr;
  fs::path userDataFolder_;
  std::array<Slot, kAccountCount> slots_{};
  std::shared_ptr<std::atomic<bool>> alive_ =
      std::make_shared<std::atomic<bool>>(true);
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
  bool podcastMode_ = false;
  bool robustSchedulerStarted_ = false;
  bool networkBlocked_ = false;
};

// tverPhase=false starts the YouTube-hour schedule: BitterBlue at 00:00,
// TALKABOUT at 04:00, one recent-song bridge, then from 20:00 the completion-
// driven Lonesome rabbit -> random B -> BitterBlue -> random D rotation.
// Initial account starts remain 40 seconds apart. Afterwards exactly one WebView
// at a time owns the recovery viewport, rotating every 15 seconds. Track-end
// handling is event driven, with a native four-minute deadline measured from the
// target song's actual play event. There is no parallel six-window DOM scanner or
// permanent DOM polling loop. Ambiguous ad/end states retry the same target until
// completion or the four-minute playback deadline. TVer keeps the rotation intact.
void SetSpotifyMediaPhase(bool tverPhase) noexcept;
void SetSpotifyMediaNetworkBlocked(bool blocked) noexcept;

}  // namespace hp
