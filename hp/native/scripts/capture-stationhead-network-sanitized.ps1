[CmdletBinding()]
param(
  [int]$DurationSeconds = 300,
  [int]$DebugPort = 9222,
  [string]$ChromePath,
  [string]$ProfileDir,
  [string]$OutDir,
  [string]$Url = "https://stationhead.com/c/buddies",
  [switch]$IncludeAllResourceTypes,
  [switch]$UnsafeFullCapture
)

$ErrorActionPreference = "Stop"

if (-not $UnsafeFullCapture) {
  if ($IncludeAllResourceTypes) {
    throw "-IncludeAllResourceTypes requires -UnsafeFullCapture. The safe default records only streakStats."
  }
  $safeScript = Join-Path $PSScriptRoot "capture-stationhead-play-stats-safe.ps1"
  if (-not (Test-Path -LiteralPath $safeScript)) {
    throw "Safe Stationhead capture script is missing: $safeScript"
  }
  $powerShell = Get-Command pwsh -ErrorAction SilentlyContinue
  if (-not $powerShell) {
    $powerShell = Get-Command powershell.exe -ErrorAction SilentlyContinue
  }
  if (-not $powerShell) {
    throw "PowerShell executable was not found."
  }
  $arguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", $safeScript,
    "-DurationSeconds", $DurationSeconds,
    "-DebugPort", $DebugPort,
    "-Url", $Url
  )
  if ($ChromePath) { $arguments += @("-ChromePath", $ChromePath) }
  if ($OutDir) { $arguments += @("-OutDir", $OutDir) }
  & $powerShell.Source @arguments
  exit $LASTEXITCODE
}

Write-Warning @"
UNSAFE FULL CAPTURE ENABLED.
The legacy capture can contain email addresses, chat text, account metadata,
device identifiers, image URLs, request bodies, and other personal data even
when authorization and cookie headers are redacted. Do not commit or share it.
"@

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  throw "Node.js is required. Install Node.js 20 or newer, then run this command again."
}

$arguments = @(
  (Join-Path $PSScriptRoot "capture-stationhead-network-sanitized.mjs"),
  "--duration", $DurationSeconds,
  "--port", $DebugPort,
  "--url", $Url
)
if ($ChromePath) { $arguments += @("--chrome", $ChromePath) }
if ($ProfileDir) { $arguments += @("--profile", $ProfileDir) }
if ($OutDir) { $arguments += @("--out", $OutDir) }
if ($IncludeAllResourceTypes) { $arguments += "--all-resource-types" }

& $node.Source @arguments
exit $LASTEXITCODE
