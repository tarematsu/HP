namespace hp {

void SpotifyWebViews::ArmMusicEndShortener(Slot& slot) noexcept {
  if (!slot.webview || slot.webMessageReceivedToken.value != 0) return;

  Slot* const target = &slot;
  const auto alive = alive_;
  EventRegistrationToken token{};
  const HRESULT added = slot.webview->add_WebMessageReceived(
      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [this, alive, target](ICoreWebView2*,
                                ICoreWebView2WebMessageReceivedEventArgs* args)
              -> HRESULT {
            if (!alive->load(std::memory_order_acquire) || !args) return S_OK;

            LPWSTR rawMessage = nullptr;
            if (FAILED(args->TryGetWebMessageAsString(&rawMessage)) ||
                !rawMessage) {
              return S_OK;
            }

            ULONGLONG eventGeneration = 0;
            ULONGLONG remainingMs = 0;
            const bool started = ParseSpotifyStartedEvent(
                rawMessage, &eventGeneration, &remainingMs);
            const bool ended = !started && ParseSpotifyGenerationEvent(
                rawMessage, L"spotify:timed-ended", &eventGeneration);
            CoTaskMemFree(rawMessage);
            if (!started && !ended) return S_OK;

            if (eventGeneration == 0 ||
                eventGeneration != target->targetGeneration ||
                target->timedTarget != TimedSpotifyTarget::Music ||
                !target->timedRotationActive) {
              return S_OK;
            }

            const ULONGLONG now = GetTickCount64();
            if (started) {
              // Direct/autoplay starts use the observer's actual remaining media
              // duration, but still enter the exact same native deadline helper
              // as a trusted Play press. A previously armed Play-press deadline
              // wins and cannot be postponed by this later observer event.
              ArmMusicCompletionDeadlineFromStart(
                  *target, now, remainingMs);
            } else {
              // ended is advisory only: shorten the same deadline to now. The
              // common ProbeDueTimedCompletions() path remains solely responsible
              // for advancing the rotation.
              ShortenMusicCompletionDeadlineAtEnd(*target, now);
            }
            ArmRobustScheduler();
            return S_OK;
          }).Get(),
      &token);

  if (SUCCEEDED(added)) {
    slot.webMessageReceivedToken = token;
  }
}

}  // namespace hp
