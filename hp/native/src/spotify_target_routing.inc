namespace hp {

void SpotifyWebViews::PostSpotifyTargetDescriptorForSlot(Slot& slot) noexcept {
  if (!slot.webview) return;

  // Reassert the generation fence here as well as at target rotation. A WebView
  // rebuild recreates the CDP evidence receiver without changing the managed
  // target generation, so the new surface needs a fresh baseline before Play.
  BeginSpotifyMediaStartEvidenceGeneration(slot.index, slot.targetGeneration);

  const ManagedTrack* const track = CurrentMusicTrack(slot);
  std::wstring message = L"spotify:target";
  message.push_back(kSpotifyMessageSeparator);
  if (track) message.append(track->path);
  message.push_back(kSpotifyMessageSeparator);
  if (track) message.append(track->title);
  slot.webview->PostWebMessageAsString(message.c_str());

  std::wstring generationMessage = L"spotify:generation";
  generationMessage.push_back(kSpotifyMessageSeparator);
  generationMessage.append(std::to_wstring(slot.targetGeneration));
  slot.webview->PostWebMessageAsString(generationMessage.c_str());
}

}  // namespace hp
