namespace hp {
namespace {

constexpr wchar_t kSpotifyPointNeedle[] = LR"JS(  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    return [
      Math.max(0, Math.min(10000, Math.round(
          ((rect.left + rect.width / 2) / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          ((rect.top + rect.height / 2) / window.innerHeight) * 10000)))
    ];
  };
)JS";

constexpr wchar_t kSpotifyViewportSafePoint[] = LR"JS(  const point = element => {
    if (!visible(element) || window.innerWidth <= 0 || window.innerHeight <= 0) {
      return null;
    }
    let rect = element.getBoundingClientRect();
    let centerX = rect.left + rect.width / 2;
    let centerY = rect.top + rect.height / 2;
    if (centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) {
      try {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (_) {}
      if (!element.isConnected) return null;
      rect = element.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
    }
    if (centerX < 0 || centerX > window.innerWidth ||
        centerY < 0 || centerY > window.innerHeight) return null;
    return [
      Math.max(0, Math.min(10000, Math.round(
          (centerX / window.innerWidth) * 10000))),
      Math.max(0, Math.min(10000, Math.round(
          (centerY / window.innerHeight) * 10000)))
    ];
  };
)JS";

constexpr wchar_t kSpotifyLatestEpisodeNeedle[] = LR"JS(      const latest = links[0];
      const container = latest.closest(
)JS";
constexpr wchar_t kSpotifyLatestEpisodeReveal[] = LR"JS(      const latest = links[0];
      try {
        latest.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (_) {}
      const container = latest.closest(
)JS";

constexpr wchar_t kSpotifyTargetTrackNeedle[] = LR"JS(    if (targetLink) {
      const row = targetLink.closest(
)JS";
constexpr wchar_t kSpotifyTargetTrackReveal[] = LR"JS(    if (targetLink) {
      try {
        targetLink.scrollIntoView({ block: 'center', inline: 'nearest' });
      } catch (_) {}
      const row = targetLink.closest(
)JS";

bool ReplaceSpotifyScriptFragment(
    std::wstring& value, std::wstring_view needle,
    std::wstring_view replacement) {
  const size_t pos = value.find(needle);
  if (pos == std::wstring::npos) return false;
  value.replace(pos, needle.size(), replacement.data(), replacement.size());
  return true;
}

}  // namespace

const wchar_t* RewriteSpotifyViewportRecoveryScript(const wchar_t* script) noexcept {
  if (!script) return script;
  try {
    thread_local std::wstring rewritten;
    rewritten.assign(script);
    bool changed = ReplaceSpotifyScriptFragment(
        rewritten, kSpotifyPointNeedle, kSpotifyViewportSafePoint);
    changed = ReplaceSpotifyScriptFragment(
                  rewritten, kSpotifyLatestEpisodeNeedle,
                  kSpotifyLatestEpisodeReveal) ||
              changed;
    changed = ReplaceSpotifyScriptFragment(
                  rewritten, kSpotifyTargetTrackNeedle,
                  kSpotifyTargetTrackReveal) ||
              changed;
    return changed ? rewritten.c_str() : script;
  } catch (...) {
    return script;
  }
}

}  // namespace hp
