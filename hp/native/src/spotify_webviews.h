#pragma once
#include "common.h"

namespace hp {

inline constexpr ULONGLONG kSpotifyMusicTrackDeadlineMs =
    4ULL * 60ULL * 1000ULL;
inline constexpr ULONGLONG kSpotifyAccountStartOffsetMs = 40ULL * 1000ULL;
inline constexpr ULONGLONG kSpotifyPodcastIntervalMs =
    2ULL * 60ULL * 60ULL * 1000ULL;

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
  static void CALLBACK StaggeredReconcileTimerProc(
      HWND hwnd, UINT message, UINT_PTR timerId, DWORD tickCount);

  enum class TimedSpotifyTarget : unsigned char {
    None,
    Music,
    TalkAbout,
    // Legacy names are retained only so old reset/recovery paths compile while
    // playback itself is driven exclusively by timedCycleTracks.
    BitterBlue,
    Monshirocho,
    Munen,
    OnMyWay,
    LonesomeRabbit,
    CatalogTrack,
  };

  static constexpr size_t kNoTimedCatalogIndex = static_cast<size_t>(-1);

 private:
  static constexpr size_t kAccountCount = 6;

  enum class SlotState : unsigned char {
    NotCreated,
    Authenticating,
    Navigating,
    WaitingTarget,
    Playing,
    Recovering,
    Completed,
  };

  struct ManagedTrack {
    std::wstring title;
    std::wstring url;
    std::wstring path;
  };

  struct RotationGroup {
    enum class Mode : unsigned char { Fixed, Shuffle, Random };
    Mode mode = Mode::Fixed;
    std::vector<ManagedTrack> tracks;
    size_t count = 0;
    bool includeTalkAbout = false;
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
    EventRegistrationToken webMessageReceivedToken{};
    EventRegistrationToken webResourceRequestedToken{};
    EventRegistrationToken timedEndMessageReceivedToken{};
    ICoreWebView2* timedEndHandlerWebview = nullptr;
    ICoreWebView2Controller* hostLayoutController = nullptr;
    RECT hostLayoutRect{};
    HWND hostLayoutInsertAfter = nullptr;
    ULONGLONG lastModeNavigateTick = 0;
    ULONGLONG controllerCreateTick = 0;
    ULONGLONG timedRotationCycle = 0;
    ULONGLONG timedPlaybackStartTick = 0;
    ULONGLONG lastTimedReconcileTick = 0;
    ULONGLONG unhealthySinceTick = 0;
    ULONGLONG reconcileRequestGeneration = 0;
    ULONGLONG reconcileStartedTick = 0;
    ULONGLONG timedObserverInstallGeneration = 0;
    ULONGLONG timedObserverInstallStartedTick = 0;
    ULONGLONG targetGeneration = 0;
    ULONGLONG trustedClickGeneration = 0;
    ULONGLONG trustedClickTargetGeneration = 0;
    ULONGLONG trustedClickBlockedUntilTick = 0;
    ULONGLONG authenticationBadgeTick = 0;
    ULONGLONG podcastDueTick = 0;
    int64_t podcastDueUnixMs = 0;
    std::vector<ManagedTrack> timedCycleTracks;
    size_t timedRotationPosition = 0;
    ULONGLONG timedCloudRotationRevision = 0;
    // Legacy scheduler state is no longer consulted by active playback.
    size_t timedCatalogIndex = kNoTimedCatalogIndex;
    size_t timedRandomFIndex = kNoTimedCatalogIndex;
    std::array<TimedSpotifyTarget, 4> timedMiddleOrder{
        TimedSpotifyTarget::BitterBlue,
        TimedSpotifyTarget::Monshirocho,
        TimedSpotifyTarget::Munen,
        TimedSpotifyTarget::OnMyWay,
    };
    SlotState state = SlotState::NotCreated;
    bool controllerCreating = false;
    bool reconcileInFlight = false;
    bool playerPage = false;
    bool loginPage = false;
    bool timedObserverReady = false;
    bool timedObserverInstallInFlight = false;
    bool timedRotationActive = false;
    bool podcastBreakActive = false;
    bool podcastPlaybackRecorded = false;
    bool hostLayoutApplied = false;
    bool hostLayoutReducedZoomApplied = false;
    TimedSpotifyTarget timedTarget = TimedSpotifyTarget::None;
  };

  struct MusicTargetDescriptor {
    const wchar_t* title = nullptr;
    const wchar_t* url = nullptr;
    const wchar_t* path = nullptr;
  };

  static LRESULT CALLBACK HostWndProc(
      HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam);
  static bool IsSpotifyPlayerUri(const wchar_t* uri) noexcept;
  static bool IsSpotifyLoginUri(const wchar_t* uri) noexcept;
  static bool ParseNormalizedPoint(LPCWSTR json, int* x, int* y) noexcept;
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
  bool ShouldRenavigateUnhealthySlot(
      const Slot& slot, ULONGLONG now) const noexcept;
  bool ExpireStaleAsyncWork(Slot& slot, ULONGLONG now) noexcept;
  void BumpSpotifyTargetGeneration(Slot& slot) noexcept;
  void ClickSlotNormalizedPoint(Slot& slot, int xTenThousandths,
                                int yTenThousandths) noexcept;
  UINT DispatchSpotifyDevToolsClick(Slot& slot, int xTenThousandths,
                                    int yTenThousandths) noexcept;
  void PostSpotifyPageContext(Slot& slot) noexcept;
  void PostSpotifyTargetDescriptorForSlot(Slot& slot) noexcept;
  void RefreshSpotifyHostLayout() noexcept;
  void EnsureCloudPlaylistLoaded() noexcept;
  const wchar_t* SpotifyPodcastUrl() const noexcept;
  const wchar_t* SpotifyPodcastPath() const noexcept;
  bool SpotifyPodcastTargetReady() const noexcept;
  ULONGLONG SpotifyPodcastIntervalMs() const noexcept;
  double SpotifyPodcastPlaybackRate() const noexcept;
  bool SlotMatchesPodcastTarget(const Slot& slot) const noexcept;
  void NavigatePodcastSlot(Slot& slot) noexcept;
  void ReconcilePodcastSlot(Slot& slot) noexcept;
  ULONGLONG NextTimedRandom() noexcept;
  void PrepareTimedRotationCycle(Slot& slot) noexcept;
  MusicTargetDescriptor ResolveMusicTarget(const Slot& slot) const noexcept;
  bool SlotMatchesMusicTarget(const Slot& slot) const noexcept;
  void NavigateMusicTarget(Slot& slot) noexcept;
  void ReconcileMusicTarget(Slot& slot) noexcept;
  void NavigateActiveTimedSlot(Slot& slot) noexcept;
  void ReconcileActiveTimedSlot(Slot& slot) noexcept;
  void ApplyTimedRotationTarget(Slot& slot) noexcept;
  void InitializeTimedRotationSlot(Slot& slot, ULONGLONG now) noexcept;
  void AdvanceTimedRotationSlot(Slot& slot, ULONGLONG now) noexcept;
  void BeginPodcastBreak(Slot& slot, ULONGLONG now) noexcept;
  void CompletePodcastBreak(Slot& slot, ULONGLONG now) noexcept;
  void EnsurePodcastScheduleLoaded(ULONGLONG now) noexcept;
  void SavePodcastScheduleState() noexcept;
  bool StartOverduePodcastBreak(ULONGLONG now) noexcept;
  void MarkPodcastPlaybackStarted(Slot& slot, ULONGLONG now) noexcept;
  bool AdvanceExpiredTimedRotation(ULONGLONG now) noexcept;
  void ArmTimedEndObserver(Slot& slot) noexcept;
  void StopTimedOneShotPlayback(Slot& slot) noexcept;
  void RecomputeForeground() noexcept;
  void PlaceHosts() noexcept;
  void CloseSlot(Slot& slot) noexcept;
  void StartAutonomousSchedule(ULONGLONG now) noexcept;
  void RunStaggeredReconcile() noexcept;

  HWND parentWindow_ = nullptr;
  fs::path userDataFolder_;
  std::array<Slot, kAccountCount> slots_{};
  std::vector<RotationGroup> cloudRotationGroups_;
  std::wstring cloudPodcastUrl_;
  std::wstring cloudPodcastPath_;
  std::wstring cloudRotationFingerprint_;
  std::wstring cloudPodcastFingerprint_;
  fs::file_time_type cloudPlaylistWriteTime_{};
  ULONGLONG cloudRotationRevision_ = 1;
  ULONGLONG podcastIntervalMs_ = kSpotifyPodcastIntervalMs;
  double podcastPlaybackRate_ = 3.0;
  std::shared_ptr<std::atomic<bool>> alive_ =
      std::make_shared<std::atomic<bool>>(true);
  size_t staggerSlotIndex_ = 0;
  ULONGLONG staggerSlotStartTick_ = 0;
  ULONGLONG scheduleStartTick_ = 0;
  ULONGLONG timedRandomState_ = 0;
  ULONGLONG lastPodcastDispatchTick_ = 0;
  bool cloudPlaylistLoaded_ = false;
  bool cloudPlaylistWriteTimeKnown_ = false;
  bool staggerSlotValidated_ = false;
  unsigned hostLayoutMask_ = ~0u;
  size_t hostLayoutActiveSlot_ = kAccountCount;
  size_t hostLayoutAuthenticationSlot_ = kAccountCount;
  bool started_ = false;
  bool robustSchedulerStarted_ = false;
  bool networkBlocked_ = false;
  bool inlineTalkAboutRotation_ = false;
  bool podcastScheduleLoaded_ = false;
};

// Spotify runs independently from the YouTube/TVer media phase. Each account
// starts 40 seconds apart and builds its cycle from cloud deviceConfig.spotify
// rotation blocks. TALKABOUT playback only uses the cloud-resolved direct
// episodeUrl; the native app never chooses an episode from the show page.
void SetSpotifyMediaPhase(bool tverPhase) noexcept;
void SetSpotifyMediaNetworkBlocked(bool blocked) noexcept;

}  // namespace hp
