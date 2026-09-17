#pragma once
#include "common.h"

namespace hp {

inline constexpr ULONGLONG kSpotifyAccountStartOffsetMs = 30ULL * 1000ULL;
// spotify-v2-1 (the former amazon window) is owned by the single Stationhead
// player. Restore the next four Spotify profiles without shifting their
// existing cookies/storage: yuukiar is profile 2, ten is profile 3, nagi is
// profile 4, and hinata is profile 5.
inline constexpr size_t kSpotifyProfileFirstAccountNumber = 2;
inline constexpr size_t kSpotifyActiveAccountCount = 4;

// Four logical Spotify accounts share exactly three live WebView runtime lanes.
// B/C/D always address lanes 0/1/2. The account that completes a full rotation
// leaves its lane, the waiting account takes it, and the completed account
// becomes the next waiter. Inline state keeps every Spotify implementation unit
// on the same process-wide lane assignment.
inline constexpr size_t kSpotifyRuntimeLaneCount = 3;
inline std::array<size_t, kSpotifyRuntimeLaneCount> gSpotifyRuntimeLaneAccounts = {
    0, 1, 2};
inline size_t gSpotifyInactiveAccountIndex = 3;

inline void ResetSpotifyRuntimeLanes() noexcept {
  gSpotifyRuntimeLaneAccounts = {0, 1, 2};
  gSpotifyInactiveAccountIndex = 3;
}

inline int SpotifyRuntimeLaneForAccount(size_t accountIndex) noexcept {
  for (size_t lane = 0; lane < gSpotifyRuntimeLaneAccounts.size(); ++lane) {
    if (gSpotifyRuntimeLaneAccounts[lane] == accountIndex) {
      return static_cast<int>(lane);
    }
  }
  return -1;
}

inline bool SpotifyAccountShouldOwnHost(size_t accountIndex) noexcept {
  return SpotifyRuntimeLaneForAccount(accountIndex) >= 0;
}

struct SpotifyPlaybackStatus {
  std::wstring windowName;
  std::wstring trackTitle;
  SYSTEMTIME confirmedAt{};
  bool confirmed = false;
};

class SpotifyWebViews final {
 public:
  SpotifyWebViews(HWND parentWindow, fs::path dataDir);
  ~SpotifyWebViews();

  SpotifyWebViews(const SpotifyWebViews&) = delete;
  SpotifyWebViews& operator=(const SpotifyWebViews&) = delete;

  void Start() noexcept;
  void Resize() noexcept;
  void Shutdown() noexcept;
  void SetNetworkBlocked(bool blocked) noexcept;
  void SetAudioOutputSlot(int slotIndex) noexcept;
  void SetMonitorForegroundSlot(int slotIndex) noexcept;
  void PollPlaybackStatusesNow() noexcept;
  int SlotIndexForWebView(ICoreWebView2* webview) const noexcept;
  std::array<SpotifyPlaybackStatus, kSpotifyActiveAccountCount>
  PlaybackStatuses() const noexcept;

 private:
  static constexpr size_t kAccountCount = kSpotifyActiveAccountCount;
  static constexpr UINT kSpotifySchedulerMessage = WM_APP + 0x53;

  enum class SlotState : unsigned char {
    NotCreated,
    Authenticating,
    Navigating,
    WaitingTarget,
    Playing,
    Recovering,
  };

  enum class AsyncWork : unsigned char {
    None,
    Reconcile,
    Observer,
  };

  struct ManagedTrack {
    std::wstring title;
    std::wstring url;
    std::wstring path;
    ULONGLONG durationMs = 0;
  };

  struct RotationGroup {
    enum class Mode : unsigned char { Fixed, Shuffle, Random };
    Mode mode = Mode::Fixed;
    std::vector<ManagedTrack> tracks;
    size_t count = 0;
  };

  struct Slot {
    SpotifyWebViews* owner = nullptr;
    size_t index = 0;
    HWND hostWindow = nullptr;
    ComPtr<ICoreWebView2Environment> environment;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> webview;
    EventRegistrationToken navigationStartingToken{};
    EventRegistrationToken navigationCompletedToken{};
    EventRegistrationToken timedEndMessageReceivedToken{};
    ComPtr<ICoreWebView2DevToolsProtocolEventReceiver> mediaErrorReceiver;
    EventRegistrationToken mediaErrorToken{};
    ICoreWebView2* timedEndHandlerWebview = nullptr;
    ICoreWebView2Controller* hostLayoutController = nullptr;
    RECT hostLayoutRect{};
    HWND hostLayoutInsertAfter = nullptr;
    SYSTEMTIME playbackConfirmedAt{};
    ULONGLONG controllerCreateTick = 0;
    ULONGLONG timedRotationCycle = 0;
    ULONGLONG timedCompletionDeadlineTick = 0;
    ULONGLONG timedCompletionDeadlineGeneration = 0;
    ULONGLONG nextRecoveryTick = 0;
    ULONGLONG nextProcessTitlePollTick = 0;
    ULONGLONG asyncEpoch = 0;
    ULONGLONG asyncStartedTick = 0;
    ULONGLONG pageEpoch = 0;
    ULONGLONG targetGeneration = 0;
    ULONGLONG trustedClickBlockedUntilTick = 0;
    ULONGLONG playRecoveryReloadGeneration = 0;
    ULONGLONG playRecoveryRecreateGeneration = 0;
    ULONGLONG mediaPipelineRecoveryGeneration = 0;
    ULONGLONG mediaKeyWaitUntilTick = 0;
    ULONGLONG mediaNetworkRecoveryTick = 0;
    size_t mediaNetworkRecoveryAttempt = 0;
    std::wstring observedTrackTitle;
    std::wstring processTrackDisplay;
    SYSTEMTIME processTitleObservedAt{};
    std::vector<ManagedTrack> timedCycleTracks;
    size_t timedRotationPosition = 0;
    ULONGLONG timedCloudRotationRevision = 0;
    int memoryUsageTargetLevel = -1;
    SlotState state = SlotState::NotCreated;
    AsyncWork asyncWork = AsyncWork::None;
    bool controllerCreating = false;
    bool loginPage = false;
    bool timedObserverReady = false;
    bool timedRotationActive = false;
    bool playbackConfirmed = false;
    bool processTitleObserved = false;
    bool hostLayoutApplied = false;
    bool mediaPipelineRecoveryPending = false;
    bool mediaKeyWaitFailurePending = false;
    bool mediaNetworkRecoveryPending = false;
  };

  static LRESULT CALLBACK HostWndProc(
      HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);
  static void CALLBACK SchedulerTimerProc(
      PTP_CALLBACK_INSTANCE instance, PVOID context, PTP_TIMER timer);
  static bool IsSpotifyPlayerUri(const wchar_t* uri) noexcept;
  static bool IsSpotifyLoginUri(const wchar_t* uri) noexcept;
  static bool ParseCssPoint(LPCWSTR json, double* x, double* y) noexcept;
  static bool SlotStateIsHealthy(SlotState state) noexcept;
  static bool SlotStateNeedsRecovery(SlotState state) noexcept;

  bool EnsureHostClass() noexcept;
  bool CreateHost(Slot& slot) noexcept;
  void CreateController(Slot& slot) noexcept;
  void Configure(Slot& slot) noexcept;
  void ArmRobustScheduler() noexcept;
  UINT NextRobustSchedulerDelayMs(ULONGLONG now) const noexcept;
  void BeginControllerCreate(Slot& slot) noexcept;
  bool SlotIsLoginPage(const Slot& slot) const noexcept;
  void SetSlotState(Slot& slot, SlotState state) noexcept;
  void MarkSlotRecovering(Slot& slot, ULONGLONG now) noexcept;
  bool ExpireStaleAsyncWork(Slot& slot, ULONGLONG now) noexcept;
  void BumpSpotifyTargetGeneration(Slot& slot) noexcept;
  void ClickSlotCssPoint(Slot& slot, double cssX, double cssY) noexcept;
  UINT DispatchSpotifyDevToolsClick(Slot& slot, double cssX,
                                    double cssY) noexcept;
  void PostSpotifyTargetDescriptorForSlot(Slot& slot) noexcept;
  void RefreshSpotifyHostLayout() noexcept;
  void BeginInitialCloudPlaylistWait(ULONGLONG now) noexcept;
  bool InitialCloudPlaylistReady(ULONGLONG now) noexcept;
  void EnsureCloudPlaylistLoaded() noexcept;
  ULONGLONG NextTimedRandom() noexcept;
  void PrepareTimedRotationCycle(Slot& slot) noexcept;
  const ManagedTrack* CurrentMusicTrack(const Slot& slot) const noexcept;
  bool SlotMatchesMusicTarget(const Slot& slot) const noexcept;
  void SetMusicCompletionDeadline(
      Slot& slot, ULONGLONG playbackStartTick,
      ULONGLONG observedRemainingMs = 0,
      bool replaceExisting = false) noexcept;
  void ShortenMusicCompletionDeadlineAtEnd(
      Slot& slot, ULONGLONG endedTick) noexcept;
  void NavigateMusicTarget(Slot& slot) noexcept;
  void ReconcileMusicTarget(Slot& slot) noexcept;
  void ApplyTimedRotationTarget(Slot& slot) noexcept;
  void InitializeTimedRotationSlot(Slot& slot) noexcept;
  void AdvanceTimedRotationSlot(Slot& slot) noexcept;
  void ArmTimedEndObserver(Slot& slot) noexcept;
  void ProbeDueTimedCompletions(ULONGLONG now) noexcept;
  void RecomputeForeground() noexcept;
  void RefreshProcessTitleStatus(Slot& slot, ICoreWebView2* webview) noexcept;
  void PollProcessTitleStatus(ULONGLONG now) noexcept;
  void PlaceHosts() noexcept;
  void CloseSlot(Slot& slot) noexcept;
  void RebuildPlaybackSurface(Slot& slot) noexcept;
  void StartAutonomousSchedule(ULONGLONG now) noexcept;
  void RunStaggeredReconcile() noexcept;

  HWND parentWindow_ = nullptr;
  fs::path userDataFolder_;
  std::array<Slot, kAccountCount> slots_{};
  std::vector<RotationGroup> cloudRotationGroups_;
  std::wstring cloudRotationFingerprint_;
  fs::file_time_type cloudPlaylistWriteTime_{};
  fs::file_time_type initialCloudPlaylistWriteTime_{};
  ULONGLONG cloudRotationRevision_ = 1;
  ULONGLONG initialCloudPlaylistWaitStartedTick_ = 0;
  ULONGLONG nextCloudPlaylistCheckTick_ = 0;
  std::shared_ptr<std::atomic<bool>> alive_ =
      std::make_shared<std::atomic<bool>>(true);
  PTP_TIMER schedulerTimer_ = nullptr;
  std::atomic<HWND> schedulerHost_{nullptr};
  std::atomic<bool> schedulerWakePosted_{false};
  size_t schedulerCursor_ = 0;
  ULONGLONG scheduleStartTick_ = 0;
  ULONGLONG timedRandomState_ = 0;
  bool cloudPlaylistLoaded_ = false;
  bool cloudPlaylistWriteTimeKnown_ = false;
  bool initialCloudPlaylistWriteTimeKnown_ = false;
  bool initialCloudPlaylistReady_ = false;
  unsigned hostLayoutMask_ = ~0u;
  size_t hostLayoutActiveSlot_ = kAccountCount;
  size_t hostLayoutAuthenticationSlot_ = kAccountCount;
  bool started_ = false;
  bool networkBlocked_ = false;
  int monitorForegroundSlot_ = -1;
};

void PollSpotifyPlaybackStatusesNow() noexcept;
std::array<SpotifyPlaybackStatus, kSpotifyActiveAccountCount>
GetSpotifyPlaybackStatuses() noexcept;

// Spotify runs independently from the YouTube/TVer media phase. Accounts become
// scheduler-eligible ten seconds apart and then run from cloud rotation blocks.
void SetSpotifyMediaPhase(bool tverPhase) noexcept;
void SetSpotifyMediaNetworkBlocked(bool blocked) noexcept;
void SetSpotifyAudioOutputSlot(int slotIndex) noexcept;
void SetSpotifyMonitorForegroundSlot(int slotIndex) noexcept;

}  // namespace hp
