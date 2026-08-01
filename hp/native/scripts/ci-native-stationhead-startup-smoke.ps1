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

# A fresh persistent profile exercises the public Start Listening controls. The
# test repeatedly collapses both playback hosts to a 1x1 HWND_BOTTOM surface
# before reading the log, so the native click request is observed while the
# Stationhead WebViews are behind the native dashboard.
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

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);

    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const uint SWP_NOSENDCHANGING = 0x0400;
    private const uint GW_HWNDNEXT = 2;
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

    public static string PlaybackSurfaceState(IntPtr window)
    {
        if (window == IntPtr.Zero) return "missing";
        RECT rect;
        if (!GetWindowRect(window, out rect)) return "rect-error";
        bool bottom = GetWindow(window, GW_HWNDNEXT) == IntPtr.Zero;
        return String.Format(
            "visible={0};width={1};height={2};bottom={3}",
            IsWindowVisible(window),
            Math.Max(0, rect.Right - rect.Left),
            Math.Max(0, rect.Bottom - rect.Top),
            bottom);
    }

    public static bool IsPlaybackBehindDashboard(IntPtr window)
    {
        if (window == IntPtr.Zero) return false;
        RECT rect;
        if (!GetWindowRect(window, out rect)) return false;
        return Math.Max(0, rect.Right - rect.Left) <= 1 &&
               Math.Max(0, rect.Bottom - rect.Top) <= 1 &&
               GetWindow(window, GW_HWNDNEXT) == IntPtr.Zero;
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

function Measure-ScreenshotContent {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  Add-Type -AssemblyName System.Drawing
  $bitmap = [System.Drawing.Bitmap]::new($Path)
  try {
    $samples = 0
    $nonDark = 0
    for ($y = 0; $y -lt $bitmap.Height; $y += 8) {
      for ($x = 0; $x -lt $bitmap.Width; $x += 8) {
        $pixel = $bitmap.GetPixel($x, $y)
        $samples += 1
        if ([Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B)) -ge 36) {
          $nonDark += 1
        }
      }
    }
    return $samples -gt 0 -and ($nonDark / $samples) -ge 0.01
  } finally {
    $bitmap.Dispose()
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

try {
  Write-Host "Starting native Stationhead background startup smoke: $executablePath"
  $process = Start-Process -FilePath $executablePath -WorkingDirectory $workingDirectory -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

  while ([DateTime]::UtcNow -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) {
      throw "HomePanel exited before Stationhead startup completed with code $($process.ExitCode)."
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
            if ($name -eq "primaryStartListeningClickRequested") {
              $primaryClickBehind = [HomePanelStationheadSmokeNative]::IsPlaybackBehindDashboard($primaryHost)
              $backgroundStateAtObservation[$name] =
                [HomePanelStationheadSmokeNative]::PlaybackSurfaceState($primaryHost)
            }
            if ($name -eq "secondaryStartListeningClickRequested") {
              $secondaryClickBehind = [HomePanelStationheadSmokeNative]::IsPlaybackBehindDashboard($secondaryHost)
              $backgroundStateAtObservation[$name] =
                [HomePanelStationheadSmokeNative]::PlaybackSurfaceState($secondaryHost)
            }
            Write-Host "Observed $name at ${elapsedMs}ms"
          }
        }
      }
    }

    $missing = @($required.Keys | Where-Object { -not $observed[$_] })
    if ($missing.Count -eq 0 -and $nativePanelsReady -and
        $primaryClickBehind -and $secondaryClickBehind) {
      break
    }
    Start-Sleep -Milliseconds 100
  }

  $missing = @($required.Keys | Where-Object { -not $observed[$_] })
  if ($missing.Count -ne 0) {
    throw "Native Stationhead startup did not reach: $($missing -join ', ')."
  }
  if (-not $primaryClickBehind -or -not $secondaryClickBehind) {
    throw "Start Listening was not observed with both Stationhead hosts at 1x1 HWND_BOTTOM."
  }
  if (-not $nativePanelsReady) {
    throw "Native dashboard panels were not created during Stationhead startup smoke."
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
  $screenshotPassed = Measure-ScreenshotContent -Path $screenshotPath
  if (-not $screenshotPassed) {
    throw "Native dashboard screenshot was missing or effectively blank."
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
    nativePanelsReady = $nativePanelsReady
    screenshotPassed = $screenshotPassed
    passed = $true
  } | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $resultPath -Encoding utf8

  Write-Host "Native Stationhead background Start Listening smoke passed."
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
