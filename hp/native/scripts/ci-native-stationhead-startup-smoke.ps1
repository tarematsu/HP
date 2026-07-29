[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,

  [int]$TimeoutSeconds = 150,

  [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$workingDirectory = Split-Path -Parent $executablePath
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $workingDirectory "ci-stationhead-startup-smoke"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

# Use a fresh persistent profile so the runner exercises the public Stationhead
# startup screen and must discover the real Start Listening control.
$dataDirectory = Join-Path $workingDirectory "data"
Remove-Item -LiteralPath $dataDirectory -Recurse -Force -ErrorAction SilentlyContinue

$logPath = Join-Path $dataDirectory "homepanel.log"
$copiedLogPath = Join-Path $OutputDirectory "homepanel.log"
$screenshotPath = Join-Path $OutputDirectory "desktop.png"
$resultPath = Join-Path $OutputDirectory "result.json"

$required = [ordered]@{
  webViewConfigured = "registering required startup scripts"
  authScriptRegistered = "auth capture script registration completed"
  startupScriptRegistered = "startup script registration completed"
  initialNavigationStarted = "startup prerequisites ready; starting initial navigation"
  stationheadUrlNavigated = "navigation (startup): https://www.stationhead.com/"
  startListeningDetected = "auto-clicking Start Listening at"
}
$observed = [ordered]@{}
foreach ($name in $required.Keys) { $observed[$name] = $false }

function Save-DesktopScreenshot {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    if ($bounds.Width -le 0 -or $bounds.Height -le 0) { return }
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
      $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $graphics.Dispose()
      $bitmap.Dispose()
    }
  } catch {
    "Screenshot unavailable: $($_.Exception.Message)" |
      Set-Content -LiteralPath (Join-Path $OutputDirectory "screenshot-error.txt") -Encoding utf8
  }
}

$process = $null
$startedAt = Get-Date
try {
  Write-Host "Starting native Stationhead startup smoke: $executablePath"
  $process = Start-Process `
    -FilePath $executablePath `
    -WorkingDirectory $workingDirectory `
    -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) {
      throw "HomePanel exited before Stationhead startup completed with code $($process.ExitCode)."
    }

    if (Test-Path -LiteralPath $logPath) {
      $log = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue
      if ($null -ne $log) {
        foreach ($name in $required.Keys) {
          if (-not $observed[$name] -and $log.Contains($required[$name])) {
            $observed[$name] = $true
            Write-Host "Observed native startup marker: $name"
          }
        }
      }
    }

    $missing = @($required.Keys | Where-Object { -not $observed[$_] })
    if ($missing.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }

  if (Test-Path -LiteralPath $logPath) {
    Copy-Item -LiteralPath $logPath -Destination $copiedLogPath -Force
  }
  Save-DesktopScreenshot

  $missing = @($required.Keys | Where-Object { -not $observed[$_] })
  [ordered]@{
    executable = $executablePath
    processId = $process.Id
    timeoutSeconds = $TimeoutSeconds
    startedAtUtc = $startedAt.ToUniversalTime().ToString("o")
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
    observed = $observed
    missing = $missing
    passed = $missing.Count -eq 0
  } | ConvertTo-Json -Depth 5 |
    Set-Content -LiteralPath $resultPath -Encoding utf8

  if ($missing.Count -ne 0) {
    throw "Native Stationhead startup did not reach: $($missing -join ', ')."
  }

  Write-Host "Native Stationhead WebView startup smoke passed."
} finally {
  if ($process) {
    $process.Refresh()
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(5000) | Out-Null
    }
  }
  if ((Test-Path -LiteralPath $logPath) -and -not (Test-Path -LiteralPath $copiedLogPath)) {
    Copy-Item -LiteralPath $logPath -Destination $copiedLogPath -Force -ErrorAction SilentlyContinue
  }
}
