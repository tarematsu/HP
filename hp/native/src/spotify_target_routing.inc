namespace hp {

void SpotifyWebViews::PostSpotifyTargetDescriptorForSlot(Slot& slot) noexcept {
  if (!slot.webview) return;

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
