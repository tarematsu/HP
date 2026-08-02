[CmdletBinding()]
param(
  [int]$DurationSeconds = 300,
  [int]$DebugPort = 9222,
  [string]$ChromePath,
  [string]$Url = "https://stationhead.com/c/buddies",
  [string]$OutDir = (Join-Path $HOME "Downloads\stationhead-safe-capture")
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if (-not $ChromePath) {
  $candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  )
  $ChromePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ChromePath) {
  throw "Google Chromeが見つかりません。-ChromePathを指定してください。"
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js 22以上が必要です。"
}
$nodeVersionText = (& $node.Source --version | Select-Object -First 1)
$nodeMajor = 0
$nodeMajorText = if ($nodeVersionText) {
  (($nodeVersionText.Trim()).TrimStart("v") -split "\.")[0]
} else {
  ""
}
if (
  $LASTEXITCODE -ne 0 -or
  -not [int]::TryParse($nodeMajorText, [ref]$nodeMajor) -or
  $nodeMajor -lt 22
) {
  throw "Node.js 22以上が必要です。現在のバージョン: $nodeVersionText"
}

$modulePath = Join-Path $PSScriptRoot "capture-stationhead-play-stats-safe.mjs"
if (-not (Test-Path $modulePath)) {
  throw "capture-stationhead-play-stats-safe.mjsを同じフォルダへ置いてください。"
}

& $node.Source $modulePath `
  --duration $DurationSeconds `
  --port $DebugPort `
  --chrome $ChromePath `
  --url $Url `
  --out $OutDir

exit $LASTEXITCODE
