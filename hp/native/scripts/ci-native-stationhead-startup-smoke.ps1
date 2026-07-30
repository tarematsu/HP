[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,

  [int]$TimeoutSeconds = 150,

  [int]$StartupBudgetSeconds = 60,

  [int]$PostClickSettleSeconds = 3,

  [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($TimeoutSeconds -le 0) { throw "TimeoutSeconds must be positive." }
if ($StartupBudgetSeconds -le 0 -or $StartupBudgetSeconds -gt $TimeoutSeconds) {
  throw "StartupBudgetSeconds must be positive and no greater than TimeoutSeconds."
}
if ($PostClickSettleSeconds -lt 0) { throw "PostClickSettleSeconds cannot be negative." }

$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$workingDirectory = Split-Path -Parent $executablePath
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $workingDirectory "ci-stationhead-startup-smoke"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

# Use a fresh persistent profile so the runner exercises the public Stationhead
# startup screen and must discover the real Start Listening control in both panes.
$dataDirectory = Join-Path $workingDirectory "data"
Remove-Item -LiteralPath $dataDirectory -Recurse -Force -ErrorAction SilentlyContinue

$logPath = Join-Path $dataDirectory "homepanel.log"
$copiedLogPath = Join-Path $OutputDirectory "homepanel.log"
$screenshotPath = Join-Path $OutputDirectory "desktop.png"
$resultPath = Join-Path $OutputDirectory "result.json"

$required = [ordered]@{
  primaryWebViewConfigured = "Stationhead A registering required startup scripts"
  primaryAuthScriptRegistered = "Stationhead A auth capture script registration completed"
  primaryStartupScriptRegistered = "Stationhead A startup script registration completed"
  primaryInitialNavigationStarted = "Stationhead A startup prerequisites ready; starting initial navigation"
  primaryStationheadUrlNavigated = "Stationhead A navigation (startup): https://www.stationhead.com/"
  primaryStartListeningClickRequested = "Stationhead A auto-clicking Start Listening at"
  secondaryWebViewConfigured = "Stationhead B registering required startup scripts"
  secondaryAuthScriptRegistered = "Stationhead B auth capture script registration completed"
  secondaryStartupScriptRegistered = "Stationhead B startup script registration completed"
  secondaryInitialNavigationStarted = "Stationhead B startup prerequisites ready; starting initial navigation"
  secondaryStationheadUrlNavigated = "Stationhead B navigation (startup): https://www.stationhead.com/"
  secondaryStartListeningClickRequested = "Stationhead B auto-clicking Start Listening at"
}
$observed = [ordered]@{}
$observedAtMs = [ordered]@{}
foreach ($name in $required.Keys) {
  $observed[$name] = $false
  $observedAtMs[$name] = $null
}

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

function Measure-ScreenshotVisibility {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    return [ordered]@{
      passed = $false
      error = "screenshot missing"
      regions = @()
    }
  }

  try {
    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::new($Path)
    try {
      if ($bitmap.Width -lt 2 -or $bitmap.Height -lt 2) {
        return [ordered]@{
          passed = $false
          error = "screenshot dimensions are invalid"
          regions = @()
        }
      }

      $middle = [int][Math]::Floor($bitmap.Width / 2)
      $regions = @()
      foreach ($definition in @(
        [ordered]@{ name = "primary"; left = 0; right = $middle },
        [ordered]@{ name = "secondary"; left = $middle; right = $bitmap.Width }
      )) {
        $sampleCount = 0
        $brightPixelCount = 0
        $minimumLuminance = 255
        $maximumLuminance = 0
        for ($y = 0; $y -lt $bitmap.Height; $y += 8) {
          for ($x = $definition.left; $x -lt $definition.right; $x += 8) {
            $pixel = $bitmap.GetPixel($x, $y)
            $maximumChannel = [Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B))
            $luminance = [int][Math]::Round(
              0.2126 * $pixel.R + 0.7152 * $pixel.G + 0.0722 * $pixel.B)
            $sampleCount += 1
            if ($maximumChannel -ge 40) { $brightPixelCount += 1 }
            $minimumLuminance = [Math]::Min($minimumLuminance, $luminance)
            $maximumLuminance = [Math]::Max($maximumLuminance, $luminance)
          }
        }
        $brightPixelRatio = if ($sampleCount -gt 0) {
          [Math]::Round($brightPixelCount / $sampleCount, 4)
        } else {
          0
        }
        $luminanceRange = $maximumLuminance - $minimumLuminance
        $regionPassed = $brightPixelRatio -ge 0.01 -and $luminanceRange -ge 32
        $regions += [ordered]@{
          name = $definition.name
          sampleCount = $sampleCount
          brightPixelCount = $brightPixelCount
          brightPixelRatio = $brightPixelRatio
          minimumLuminance = $minimumLuminance
          maximumLuminance = $maximumLuminance
          luminanceRange = $luminanceRange
          passed = $regionPassed
        }
      }

      return [ordered]@{
        passed = @($regions | Where-Object { -not $_.passed }).Count -eq 0
        error = $null
        regions = $regions
      }
    } finally {
      $bitmap.Dispose()
    }
  } catch {
    return [ordered]@{
      passed = $false
      error = $_.Exception.Message
      regions = @()
    }
  }
}

$process = $null
$startedAtUtc = [DateTime]::UtcNow
$failureReason = $null
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
      $failureReason = "HomePanel exited before Stationhead startup completed with code $($process.ExitCode)."
      break
    }

    if (Test-Path -LiteralPath $logPath) {
      $log = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue
      if ($null -ne $log) {
        foreach ($name in $required.Keys) {
          if (-not $observed[$name] -and $log.Contains($required[$name])) {
            $elapsedMs = [int][Math]::Round(([DateTime]::UtcNow - $startedAtUtc).TotalMilliseconds)
            $observed[$name] = $true
            $observedAtMs[$name] = $elapsedMs
            Write-Host "Observed native startup marker: $name at ${elapsedMs}ms"
          }
        }
      }
    }

    $missing = @($required.Keys | Where-Object { -not $observed[$_] })
    if ($missing.Count -eq 0) { break }
    Start-Sleep -Milliseconds 250
  }

  $missing = @($required.Keys | Where-Object { -not $observed[$_] })
  if (-not $failureReason -and $missing.Count -eq 0 -and $PostClickSettleSeconds -gt 0) {
    Start-Sleep -Seconds $PostClickSettleSeconds
  }

  if (Test-Path -LiteralPath $logPath) {
    Copy-Item -LiteralPath $logPath -Destination $copiedLogPath -Force
  }
  Save-DesktopScreenshot

  $primaryElapsedMs = $observedAtMs.primaryStartListeningClickRequested
  $secondaryElapsedMs = $observedAtMs.secondaryStartListeningClickRequested
  $startupElapsedMs = if ($null -ne $primaryElapsedMs -and $null -ne $secondaryElapsedMs) {
    [Math]::Max([int]$primaryElapsedMs, [int]$secondaryElapsedMs)
  } else {
    $null
  }
  $startupBudgetPassed = $null -ne $startupElapsedMs -and
    $startupElapsedMs -le ($StartupBudgetSeconds * 1000)
  $screenVisibility = Measure-ScreenshotVisibility -Path $screenshotPath
  $passed = -not $failureReason -and $missing.Count -eq 0 -and
    $startupBudgetPassed -and $screenVisibility.passed

  [ordered]@{
    executable = $executablePath
    processId = if ($process) { $process.Id } else { $null }
    timeoutSeconds = $TimeoutSeconds
    startupBudgetSeconds = $StartupBudgetSeconds
    postClickSettleSeconds = $PostClickSettleSeconds
    startedAtUtc = $startedAtUtc.ToString("o")
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
    observed = $observed
    observedAtMs = $observedAtMs
    startupElapsedMs = $startupElapsedMs
    startupBudgetPassed = $startupBudgetPassed
    screenVisibility = $screenVisibility
    missing = $missing
    failureReason = $failureReason
    passed = $passed
  } | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $resultPath -Encoding utf8

  if ($failureReason) { throw $failureReason }
  if ($missing.Count -ne 0) {
    throw "Native Stationhead startup did not reach: $($missing -join ', ')."
  }
  if (-not $startupBudgetPassed) {
    throw "Native Stationhead startup exceeded the ${StartupBudgetSeconds}s budget (${startupElapsedMs}ms)."
  }
  if (-not $screenVisibility.passed) {
    $failedRegions = @($screenVisibility.regions | Where-Object { -not $_.passed } |
      ForEach-Object { $_.name })
    $detail = if ($screenVisibility.error) {
      $screenVisibility.error
    } else {
      "dark or low-contrast regions: $($failedRegions -join ', ')"
    }
    throw "Native Stationhead startup screenshot did not prove visible content: $detail."
  }

  Write-Host "Native Stationhead WebView startup smoke passed in ${startupElapsedMs}ms with visible content in both panes."
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
