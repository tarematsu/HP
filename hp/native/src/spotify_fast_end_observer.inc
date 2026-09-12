namespace hp {
namespace {

// Assemble the target observer and its minimal event bindings into one
// ExecuteScript call. Completion detection is intentionally absent: native owns
// the one-shot completion deadline after the validated start event.
const std::wstring kSpotifyFastEndObserverScriptStorage = [] {
  std::wstring script;
  script.reserve(
      std::size(kSpotifyMediaObserverRuntimeScript) +
      std::size(kSpotifyMediaObserverEventsScript) + 3U);
  script.append(kSpotifyMediaObserverRuntimeScript);
  script.append(L";\n");
  script.append(kSpotifyMediaObserverEventsScript);
  script.push_back(L';');
  return script;
}();

const wchar_t* const kSpotifyFastEndObserverScript =
    kSpotifyFastEndObserverScriptStorage.c_str();

}  // namespace
}  // namespace hp
