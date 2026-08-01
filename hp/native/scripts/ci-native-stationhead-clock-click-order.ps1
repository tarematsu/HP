[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$LogPath,

  [int]$MinimumDelaySeconds = 1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($MinimumDelaySeconds -lt 1) {
  throw "MinimumDelaySeconds must be at least one second."
}

$resolvedLogPath = (Resolve-Path -LiteralPath $LogPath).Path
$lines = @(Get-Content -LiteralPath $resolvedLogPath -Encoding utf8)
if ($lines.Count -eq 0) { throw "Stationhead smoke log is empty." }

$navigationPatterns = [ordered]@{
  A = "Stationhead A navigation (clock even-minute destination switch):"
  B = "Stationhead B navigation (clock odd-minute destination switch):"
}
$clickPatterns = [ordered]@{
  A = "Stationhead A auto-clicking Start Listening at"
  B = "Stationhead B auto-clicking Start Listening at"
}

function Read-LogTimestamp {
  param([Parameter(Mandatory = $true)][string]$Line)
  $match = [regex]::Match(
    $Line,
    '^\[(?<value>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]')
  if (-not $match.Success) {
    throw "Log line has no timestamp: $Line"
  }
  return [DateTime]::ParseExact(
    $match.Groups['value'].Value,
    'yyyy-MM-dd HH:mm:ss',
    [Globalization.CultureInfo]::InvariantCulture,
    [Globalization.DateTimeStyles]::AssumeLocal)
}

$selectedRole = $null
$navigationIndex = -1
for ($index = 0; $index -lt $lines.Count; $index += 1) {
  foreach ($role in $navigationPatterns.Keys) {
    if ($lines[$index].Contains($navigationPatterns[$role])) {
      $selectedRole = $role
      $navigationIndex = $index
      break
    }
  }
  if ($selectedRole) { break }
}
if (-not $selectedRole) {
  throw "No even-minute A or odd-minute B clock navigation was recorded."
}

$clickIndex = -1
for ($index = $navigationIndex + 1; $index -lt $lines.Count; $index += 1) {
  if ($lines[$index].Contains($clickPatterns[$selectedRole])) {
    $clickIndex = $index
    break
  }
}
if ($clickIndex -lt 0) {
  throw "Window $selectedRole did not log Start Listening after clock navigation."
}

$navigationAt = Read-LogTimestamp -Line $lines[$navigationIndex]
$clickAt = Read-LogTimestamp -Line $lines[$clickIndex]
$delaySeconds = [int][Math]::Floor(($clickAt - $navigationAt).TotalSeconds)
if ($delaySeconds -lt $MinimumDelaySeconds) {
  throw "Window $selectedRole logged Start Listening only ${delaySeconds}s after navigation; this can be an outgoing-document click."
}

Write-Host "Window $selectedRole post-navigation Start Listening delay verified: ${delaySeconds}s."
