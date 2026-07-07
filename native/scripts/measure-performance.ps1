[CmdletBinding()]
param(
  [int]$DurationMinutes = 55,
  [int]$IntervalSeconds = 5,
  [string]$Output = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "data\performance.csv")
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null
"timestamp,elapsedMinutes,homePanelWorkingSetMB,webViewWorkingSetMB,totalMemoryPercent,homePanelCpuSeconds,webViewCpuSeconds" | Set-Content -Encoding utf8 $Output
$started = Get-Date
while (((Get-Date) - $started).TotalMinutes -lt $DurationMinutes) {
  $home = Get-Process HomePanel -ErrorAction SilentlyContinue | Select-Object -First 1
  $web = @(Get-Process msedgewebview2 -ErrorAction SilentlyContinue)
  $os = Get-CimInstance Win32_OperatingSystem
  $usedPercent = 100 * (1 - ($os.FreePhysicalMemory / $os.TotalVisibleMemorySize))
  $row = [pscustomobject]@{
    timestamp = (Get-Date).ToString("o")
    elapsedMinutes = [math]::Round(((Get-Date) - $started).TotalMinutes, 2)
    homePanelWorkingSetMB = if ($home) { [math]::Round($home.WorkingSet64 / 1MB, 2) } else { 0 }
    webViewWorkingSetMB = [math]::Round((($web | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 2)
    totalMemoryPercent = [math]::Round($usedPercent, 2)
    homePanelCpuSeconds = if ($home) { [math]::Round($home.CPU, 2) } else { 0 }
    webViewCpuSeconds = [math]::Round((($web | Measure-Object CPU -Sum).Sum), 2)
  }
  ($row.timestamp, $row.elapsedMinutes, $row.homePanelWorkingSetMB, $row.webViewWorkingSetMB, $row.totalMemoryPercent, $row.homePanelCpuSeconds, $row.webViewCpuSeconds) -join "," | Add-Content -Encoding utf8 $Output
  Start-Sleep -Seconds $IntervalSeconds
}
Write-Host "Saved: $Output"
