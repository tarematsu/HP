#pragma once
#include "common.h"

namespace hp {

inline constexpr ULONGLONG kSpotifyAccountStartOffsetMs = 10ULL * 1000ULL;
// spotify-v2-1 (the former amazon window) is owned by the single Stationhead
// player. Restore the next two Spotify profiles without shifting their existing
// cookies/storage: yuukiar is profile 2 and ten is profile 3.
inline constexpr size_t kSpotifyProfileFirstAccountNumber = 2;
inline constexpr size_t kSpotifyActiveAccountCount = 2;

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
  void SetOutputMuted(bool muted) noexcept;
  void SetMonitorForeground(bool foreground) noexcept;
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
    std::wstring observedTrackTitle;
    std::wstring processTrackDisplay;
    SYSTEMTIME processTitleObservedAt{};
    std::vector<ManagedTrack> timedCycleTracks;
    size_t timedRotationPosition = 0;
    ULONGLONG timedCloudRotationRevision = 0;
    SlotState state = SlotState::NotCreated;
    AsyncWork asyncWork = AsyncWork::None;
    bool controllerCreating = false;
    bool loginPage = false;
    bool timedObserverReady = false;
    bool timedRotationActive = false;
    bool playbackConfirmed = false;
    bool processTitleObserved = false;
    bool hostLayoutApplied = false;
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
  bool monitorForeground_ = false;
};

std::array<SpotifyPlaybackStatus, kSpotifyActiveAccountCount>
GetSpotifyPlaybackStatuses() noexcept;

// Spotify runs independently from the YouTube/TVer media phase. Accounts become
// scheduler-eligible ten seconds apart and then run from cloud rotation blocks.
void SetSpotifyMediaPhase(bool tverPhase) noexcept;
void SetSpotifyMediaNetworkBlocked(bool blocked) noexcept;
void SetSpotifyAudioMuted(bool muted) noexcept;
void SetSpotifyMonitorForeground(bool foreground) noexcept;

}  // namespace hp
