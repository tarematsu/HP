[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,

  [int]$TimeoutSeconds = 210,

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

# A fresh persistent profile exercises the public Start Listening controls. Both
# playback hosts are repeatedly collapsed to 1x1 and sent behind the native
# dashboard before startup and clock-switch click markers are sampled.
$dataDirectory = Join-Path $workingDirectory "data"
Remove-Item -LiteralPath $dataDirectory -Recurse -Force -ErrorAction SilentlyContinue

$logPath = Join-Path $dataDirectory "homepanel.log"
$copiedLogPath = Join-Path $OutputDirectory "homepanel.log"
$screenshotPath = Join-Path $OutputDirectory "desktop.png"
$resultPath = Join-Path $OutputDirectory "result.json"

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class HomePanelStationheadSmokeNative
{
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumChildWindows(
        IntPtr parent, EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr window, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const uint SWP_NOSENDCHANGING = 0x0400;
    private static readonly IntPtr HWND_BOTTOM = new IntPtr(1);

    private static string ClassName(IntPtr window)
    {
        var text = new StringBuilder(256);
        return GetClassName(window, text, text.Capacity) > 0
            ? text.ToString()
            : String.Empty;
    }

    public static IntPtr FindTopLevelWindow(int processId, string className)
    {
        IntPtr result = IntPtr.Zero;
        EnumWindows((window, parameter) =>
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == (uint)processId &&
                String.Equals(ClassName(window), className, StringComparison.Ordinal))
            {
                result = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static IntPtr FindChildWindow(IntPtr parent, string className)
    {
        IntPtr result = IntPtr.Zero;
        EnumChildWindows(parent, (window, parameter) =>
        {
            if (String.Equals(ClassName(window), className, StringComparison.Ordinal))
            {
                result = window;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return result;
    }

    public static string[] ChildWindowClasses(IntPtr parent)
    {
        var results = new List<string>();
        EnumChildWindows(parent, (window, parameter) =>
        {
            results.Add(ClassName(window));
            return true;
        }, IntPtr.Zero);
        return results.ToArray();
    }

    public static bool ForcePlaybackBehindDashboard(IntPtr window)
    {
        if (window == IntPtr.Zero) return false;
        return SetWindowPos(
            window, HWND_BOTTOM, 0, 0, 1, 1,
            SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOSENDCHANGING);
    }

    public static string PlaybackSurfaceState(IntPtr window, IntPtr expectedParent)
    {
        if (window == IntPtr.Zero) return "missing";
        RECT rect;
        if (!GetWindowRect(window, out rect)) return "rect-error";
        return String.Format(
            "visible={0};width={1};height={2};parentMatch={3}",
            IsWindowVisible(window),
            Math.Max(0, rect.Right - rect.Left),
            Math.Max(0, rect.Bottom - rect.Top),
            GetParent(window) == expectedParent);
    }

    public static bool IsPlaybackBehindDashboard(IntPtr window, IntPtr expectedParent)
    {
        if (window == IntPtr.Zero || expectedParent == IntPtr.Zero) return false;
        RECT rect;
        if (!GetWindowRect(window, out rect)) return false;
        return IsWindowVisible(window) &&
               GetParent(window) == expectedParent &&
               Math.Max(0, rect.Right - rect.Left) <= 1 &&
               Math.Max(0, rect.Bottom - rect.Top) <= 1;
    }
}
'@

$required = [ordered]@{
  primaryWebViewConfigured = "Stationhead A registering required startup scripts"
  primaryStartupScriptRegistered = "Stationhead A startup script registration completed"
  primaryStationheadUrlNavigated = "Stationhead A navigation (startup): https://www.stationhead.com/sakuramankai"
  primaryStartListeningClickRequested = "Stationhead A auto-clicking Start Listening at"
  secondaryWebViewConfigured = "Stationhead B registering required startup scripts"
  secondaryStartupScriptRegistered = "Stationhead B startup script registration completed"
  secondaryStationheadUrlNavigated = "Stationhead B navigation (startup): https://www.stationhead.com/buddy46"
  secondaryStartListeningClickRequested = "Stationhead B auto-clicking Start Listening at"
}
$clockSwitchMarkers = [ordered]@{
  A = "Stationhead A navigation (clock even-minute destination switch): https://www.stationhead.com/buddy46"
  B = "Stationhead B navigation (clock odd-minute destination switch): https://www.stationhead.com/sakuramankai"
}
$clockSwitchClickMarkers = [ordered]@{
  A = "Stationhead A auto-clicking Start Listening at"
  B = "Stationhead B auto-clicking Start Listening at"
}
$observed = [ordered]@{}
$observedAtMs = [ordered]@{}
$backgroundStateAtObservation = [ordered]@{}
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
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
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

      $sampleCount = 0
      $brightPixelCount = 0
      $minimumLuminance = 255
      $maximumLuminance = 0
      for ($y = 0; $y -lt $bitmap.Height; $y += 8) {
        for ($x = 0; $x -lt $bitmap.Width; $x += 8) {
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
      $regions = @([ordered]@{
        name = "nativeDashboard"
        sampleCount = $sampleCount
        brightPixelCount = $brightPixelCount
        brightPixelRatio = $brightPixelRatio
        minimumLuminance = $minimumLuminance
        maximumLuminance = $maximumLuminance
        luminanceRange = $luminanceRange
        passed = $regionPassed
      })
      return [ordered]@{
        passed = $regionPassed
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
$mainWindow = [IntPtr]::Zero
$primaryHost = [IntPtr]::Zero
$secondaryHost = [IntPtr]::Zero
$primaryClickBehind = $false
$secondaryClickBehind = $false
$nativePanelsReady = $false
$switchedRole = $null
$switchLogIndex = -1
$switchObservedAtMs = $null
$switchedClickObservedAtMs = $null
$switchedClickBehindDashboard = $false

try {
  Write-Host "Starting native Stationhead background clock-switch smoke: $executablePath"
  $process = Start-Process -FilePath $executablePath -WorkingDirectory $workingDirectory -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

  while ([DateTime]::UtcNow -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) {
      throw "HomePanel exited before Stationhead clock-switch smoke completed with code $($process.ExitCode)."
    }

    if ($mainWindow -eq [IntPtr]::Zero) {
      $mainWindow = [HomePanelStationheadSmokeNative]::FindTopLevelWindow(
        $process.Id, "HomePanelNativeWindow")
    }
    if ($mainWindow -ne [IntPtr]::Zero) {
      $primaryHost = [HomePanelStationheadSmokeNative]::FindChildWindow(
        $mainWindow, "HomePanelStationheadHost")
      $secondaryHost = [HomePanelStationheadSmokeNative]::FindChildWindow(
        $mainWindow, "HomePanelSecondaryStationheadHost")
      if ($primaryHost -ne [IntPtr]::Zero) {
        [HomePanelStationheadSmokeNative]::ForcePlaybackBehindDashboard($primaryHost) | Out-Null
      }
      if ($secondaryHost -ne [IntPtr]::Zero) {
        [HomePanelStationheadSmokeNative]::ForcePlaybackBehindDashboard($secondaryHost) | Out-Null
      }
      $classes = @([HomePanelStationheadSmokeNative]::ChildWindowClasses($mainWindow))
      $nativePanelsReady = @($classes | Where-Object { $_ -eq "HomePanelNativeStaticPanel" }).Count -ge 3
    }

    if (Test-Path -LiteralPath $logPath) {
      $log = Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue
      if ($null -ne $log) {
        foreach ($name in $required.Keys) {
          if (-not $observed[$name] -and $log.Contains($required[$name])) {
            $elapsedMs = [int][Math]::Round(([DateTime]::UtcNow - $startedAtUtc).TotalMilliseconds)
            $observed[$name] = $true
            $observedAtMs[$name] = $elapsedMs
            Write-Host "Observed $name at ${elapsedMs}ms"
          }
        }

        if (-not $switchedRole) {
          foreach ($role in $clockSwitchMarkers.Keys) {
            $candidateIndex = $log.IndexOf($clockSwitchMarkers[$role])
            if ($candidateIndex -ge 0) {
              $switchedRole = $role
              $switchLogIndex = $candidateIndex
              $switchObservedAtMs = [int][Math]::Round(
                ([DateTime]::UtcNow - $startedAtUtc).TotalMilliseconds)
              Write-Host "Observed clock switch for Window $role at ${switchObservedAtMs}ms"
              break
            }
          }
        }

        if ($switchedRole -and $null -eq $switchedClickObservedAtMs) {
          $searchAt = $switchLogIndex + $clockSwitchMarkers[$switchedRole].Length
          $clickIndex = $log.IndexOf($clockSwitchClickMarkers[$switchedRole], $searchAt)
          if ($clickIndex -ge 0) {
            $switchedClickObservedAtMs = [int][Math]::Round(
              ([DateTime]::UtcNow - $startedAtUtc).TotalMilliseconds)
            Write-Host "Observed post-switch Start Listening click for Window $switchedRole at ${switchedClickObservedAtMs}ms"
          }
        }
      }
    }

    if ($observed.primaryStartListeningClickRequested) {
      $primaryClickBehind = [HomePanelStationheadSmokeNative]::IsPlaybackBehindDashboard(
        $primaryHost, $mainWindow)
      $backgroundStateAtObservation.primaryStartListeningClickRequested =
        [HomePanelStationheadSmokeNative]::PlaybackSurfaceState($primaryHost, $mainWindow)
    }
    if ($observed.secondaryStartListeningClickRequested) {
      $secondaryClickBehind = [HomePanelStationheadSmokeNative]::IsPlaybackBehindDashboard(
        $secondaryHost, $mainWindow)
      $backgroundStateAtObservation.secondaryStartListeningClickRequested =
        [HomePanelStationheadSmokeNative]::PlaybackSurfaceState($secondaryHost, $mainWindow)
    }
    if ($switchedRole -and $null -ne $switchedClickObservedAtMs) {
      $switchedHost = if ($switchedRole -eq "A") { $primaryHost } else { $secondaryHost }
      $switchedClickBehindDashboard =
        [HomePanelStationheadSmokeNative]::IsPlaybackBehindDashboard(
          $switchedHost, $mainWindow)
      $backgroundStateAtObservation.switchedStartListeningClickRequested =
        [HomePanelStationheadSmokeNative]::PlaybackSurfaceState(
          $switchedHost, $mainWindow)
    }

    $missing = @($required.Keys | Where-Object { -not $observed[$_] })
    if ($missing.Count -eq 0 -and $nativePanelsReady -and
        $primaryClickBehind -and $secondaryClickBehind -and
        $switchedRole -and $null -ne $switchedClickObservedAtMs -and
        $switchedClickBehindDashboard) {
      break
    }
    Start-Sleep -Milliseconds 100
  }

  $missing = @($required.Keys | Where-Object { -not $observed[$_] })
  if ($missing.Count -ne 0) {
    throw "Native Stationhead startup did not reach: $($missing -join ', ')."
  }
  if (-not $primaryClickBehind -or -not $secondaryClickBehind) {
    throw "Initial Start Listening was not observed with both Stationhead hosts collapsed behind the dashboard."
  }
  if (-not $nativePanelsReady) {
    throw "Native dashboard panels were not created during Stationhead startup smoke."
  }
  if (-not $switchedRole) {
    throw "No even-minute A or odd-minute B destination switch was observed."
  }
  if ($null -eq $switchedClickObservedAtMs) {
    throw "Window $switchedRole did not request Start Listening after its clock destination switch."
  }
  if (-not $switchedClickBehindDashboard) {
    throw "Post-switch Start Listening was not observed with Window $switchedRole collapsed behind the dashboard."
  }

  $startupElapsedMs = [Math]::Max(
    [int]$observedAtMs.primaryStartListeningClickRequested,
    [int]$observedAtMs.secondaryStartListeningClickRequested)
  if ($startupElapsedMs -gt ($StartupBudgetSeconds * 1000)) {
    throw "Native Stationhead startup exceeded the ${StartupBudgetSeconds}s budget (${startupElapsedMs}ms)."
  }

  if ($PostClickSettleSeconds -gt 0) { Start-Sleep -Seconds $PostClickSettleSeconds }
  if ($primaryHost -ne [IntPtr]::Zero) {
    [HomePanelStationheadSmokeNative]::ForcePlaybackBehindDashboard($primaryHost) | Out-Null
  }
  if ($secondaryHost -ne [IntPtr]::Zero) {
    [HomePanelStationheadSmokeNative]::ForcePlaybackBehindDashboard($secondaryHost) | Out-Null
  }
  Save-DesktopScreenshot
  $screenVisibility = Measure-ScreenshotVisibility -Path $screenshotPath
  if (-not $screenVisibility.passed) {
    $detail = if ($screenVisibility.error) {
      $screenVisibility.error
    } else {
      "native dashboard is dark or low contrast"
    }
    throw "Native Stationhead clock-switch screenshot did not prove visible dashboard content: $detail."
  }

  [ordered]@{
    executable = $executablePath
    processId = $process.Id
    startedAtUtc = $startedAtUtc.ToString("o")
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
    startupElapsedMs = $startupElapsedMs
    startupBudgetSeconds = $StartupBudgetSeconds
    observed = $observed
    observedAtMs = $observedAtMs
    backgroundStateAtObservation = $backgroundStateAtObservation
    primaryClickBehindDashboard = $primaryClickBehind
    secondaryClickBehindDashboard = $secondaryClickBehind
    switchedRole = $switchedRole
    switchObservedAtMs = $switchObservedAtMs
    switchedClickObservedAtMs = $switchedClickObservedAtMs
    switchedClickBehindDashboard = $switchedClickBehindDashboard
    nativePanelsReady = $nativePanelsReady
    screenVisibility = $screenVisibility
    passed = $true
  } | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $resultPath -Encoding utf8

  Write-Host "Native Stationhead background clock-switch smoke passed."
} finally {
  if ($process) {
    $process.Refresh()
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(5000) | Out-Null
    }
  }
  if (Test-Path -LiteralPath $logPath) {
    Copy-Item -LiteralPath $logPath -Destination $copiedLogPath -Force -ErrorAction SilentlyContinue
  }
}
