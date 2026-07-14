[CmdletBinding()]
param(
  [int]$DurationSeconds = 300,
  [int]$DebugPort = 9222,
  [string]$ChromePath,
  [string]$ProfileDir,
  [string]$OutDir,
  [string]$Url = "https://stationhead.com/c/buddies",
  [switch]$IncludeAllResourceTypes
)

$ErrorActionPreference = "Stop"
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
