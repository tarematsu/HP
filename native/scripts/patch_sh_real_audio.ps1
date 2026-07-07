param(
  [Parameter(Mandatory = $true)][string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$utf8 = [Text.UTF8Encoding]::new($false)

function Read-Normalized([string]$Path) {
  return [IO.File]::ReadAllText($Path).Replace("`r`n", "`n").Replace("`r", "`n")
}

function Write-Utf8([string]$Path, [string]$Text) {
  [IO.File]::WriteAllText($Path, $Text, $utf8)
}

function Replace-RequiredOrApplied {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Old,
    [Parameter(Mandatory = $true)][string]$New,
    [Parameter(Mandatory = $true)][string]$Name
  )
  $oldNormalized = $Old.Replace("`r`n", "`n").Replace("`r", "`n")
  $newNormalized = $New.Replace("`r`n", "`n").Replace("`r", "`n")
  if ($Text.Contains($newNormalized)) { return $Text }
  if ($Text.Contains($oldNormalized)) { return $Text.Replace($oldNormalized, $newNormalized) }
  throw "Required real-audio patch '$Name' did not match."
}

$secondaryPath = Join-Path $OutputDir 'secondary_stationhead.generated.cpp'
$secondary = Read-Normalized $secondaryPath

$oldSecondaryPlaying = @'
  const playing = () => {
    if (navigator.mediaSession?.playbackState === 'playing') return true;
    return Array.from(document.querySelectorAll('audio,video')).some(element =>
      !element.paused && !element.ended && element.readyState >= 2);
  };
'@
$newSecondaryPlaying = @'
  const mediaElements = () => Array.from(document.querySelectorAll('audio,video'));
  const playing = () => mediaElements().some(element =>
    !element.paused && !element.ended && element.readyState >= 2 && element.currentTime > 0);
  const sessionPlaying = () => navigator.mediaSession?.playbackState === 'playing';
  const promptMediaPlayback = () => {
    for (const element of mediaElements()) {
      try { element.muted = false; element.volume = 1; element.play?.().catch?.(() => {}); } catch (_) {}
    }
  };
'@
$secondary = Replace-RequiredOrApplied $secondary $oldSecondaryPlaying $newSecondaryPlaying `
  'secondary real media playback predicate'

$oldSecondaryScan = @'
    const isPlaying = publishAudio();
    if (!ready || isPlaying || !document.body) return;
'@
$newSecondaryScan = @'
    const isPlaying = publishAudio();
    if (!ready || isPlaying || !document.body) return;
    if (sessionPlaying()) promptMediaPlayback();
'@
$secondary = Replace-RequiredOrApplied $secondary $oldSecondaryScan $newSecondaryScan `
  'secondary mediaSession playback prompt without success'

Write-Utf8 $secondaryPath $secondary
Write-Output 'Patched Stationhead secondary to require real media playback before reporting audio'
