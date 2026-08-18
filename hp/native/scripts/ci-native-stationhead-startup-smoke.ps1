[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,

  [int]$TimeoutSeconds = 90,

  [int]$StartupBudgetSeconds = 60,

  [int]$PostClickSettleSeconds = 15,

  [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($TimeoutSeconds -le 0) { throw "TimeoutSeconds must be positive." }
if ($StartupBudgetSeconds -le 0 -or $StartupBudgetSeconds -gt $TimeoutSeconds) {
  throw "StartupBudgetSeconds must be positive and no greater than TimeoutSeconds."
}
if ($PostClickSettleSeconds -lt 12) {
  throw "PostClickSettleSeconds must be at least 12 seconds to cover delayed audio-loss foreground paths."
}

$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$workingDirectory = Split-Path -Parent $executablePath
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $workingDirectory "ci-stationhead-startup-smoke"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

# This test is observational. It must never resize, hide, show, reorder, or focus
# an application window. A source-level self-audit prevents a false positive.
$scriptSource = Get-Content -LiteralPath $PSCommandPath -Raw
$forbiddenMutationNames = @(
  ('Set' + 'WindowPos'),
  ('Move' + 'Window'),
  ('Show' + 'Window'),
  ('Set' + 'ForegroundWindow'),
  ('Bring' + 'WindowToTop'),
  ('Set' + 'Parent'),
  ('Set' + 'WindowLong'),
  ('Set' + 'ActiveWindow'),
  ('SwitchToThis' + 'Window'),
  ('Enable' + 'Window'),
  ('ForcePlayback' + 'BehindDashboard')
)
foreach ($name in $forbiddenMutationNames) {
  if ($scriptSource.Contains($name)) {
    throw "Stationhead smoke test contains forbidden window mutation API: $name"
  }
}

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

public static class HomePanelStationheadObserveNative
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

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr window, uint command);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr window, out RECT rect);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    private const uint GW_CHILD = 5;
    private const uint GW_HWNDNEXT = 2;

    private static string ClassName(IntPtr window)
    {
        var text = new StringBuilder(256);
        return GetClassName(window, text, text.Capacity) > 0
            ? text.ToString()
            : String.Empty;
    }

    private static List<IntPtr> DirectChildren(IntPtr parent)
    {
        var children = new List<IntPtr>();
        for (IntPtr child = GetWindow(parent, GW_CHILD);
             child != IntPtr.Zero;
             child = GetWindow(child, GW_HWNDNEXT))
        {
            if (GetParent(child) == parent) children.Add(child);
        }
        return children;
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

    public static int NativePanelCount(IntPtr parent)
    {
        int count = 0;
        foreach (IntPtr child in DirectChildren(parent))
        {
            if (String.Equals(ClassName(child), "HomePanelNativeStaticPanel", StringComparison.Ordinal))
            {
                count += 1;
            }
        }
        return count;
    }

    public static bool HasDirectChild(IntPtr parent, string className)
    {
        foreach (IntPtr child in DirectChildren(parent))
        {
            if (String.Equals(ClassName(child), className, StringComparison.Ordinal))
            {
                return true;
            }
        }
        return false;
    }

    public static bool PlaybackStartupSafe(IntPtr parent, string className)
    {
        if (parent == IntPtr.Zero) return true;
        List<IntPtr> children = DirectChildren(parent);
        int hostIndex = -1;
        int lastPanelIndex = -1;
        IntPtr host = IntPtr.Zero;
        for (int index = 0; index < children.Count; index += 1)
        {
            string currentClass = ClassName(children[index]);
            if (String.Equals(currentClass, className, StringComparison.Ordinal))
            {
                hostIndex = index;
                host = children[index];
            }
            if (String.Equals(currentClass, "HomePanelNativeStaticPanel", StringComparison.Ordinal))
            {
                lastPanelIndex = index;
            }
        }
        if (host == IntPtr.Zero) return true;
        RECT rect;
        if (!GetWindowRect(host, out rect)) return false;
        int width = Math.Max(0, rect.Right - rect.Left);
        int height = Math.Max(0, rect.Bottom - rect.Top);
        bool belowExistingPanels = lastPanelIndex < 0 || hostIndex > lastPanelIndex;
        return width <= 1 && height <= 1 && belowExistingPanels;
    }

    public static bool PlaybackBehindNativePanels(IntPtr parent, string className)
    {
        if (parent == IntPtr.Zero) return false;
        List<IntPtr> children = DirectChildren(parent);
        int hostIndex = -1;
        int lastPanelIndex = -1;
        IntPtr host = IntPtr.Zero;
        for (int index = 0; index < children.Count; index += 1)
        {
            string currentClass = ClassName(children[index]);
            if (String.Equals(currentClass, className, StringComparison.Ordinal))
            {
                hostIndex = index;
                host = children[index];
            }
            if (String.Equals(currentClass, "HomePanelNativeStaticPanel", StringComparison.Ordinal))
            {
                lastPanelIndex = index;
            }
        }
        if (host == IntPtr.Zero || hostIndex < 0 || lastPanelIndex < 0 ||
            hostIndex <= lastPanelIndex || !IsWindowVisible(host))
        {
            return false;
        }
        RECT rect;
        if (!GetWindowRect(host, out rect)) return false;
        int width = Math.Max(0, rect.Right - rect.Left);
        int height = Math.Max(0, rect.Bottom - rect.Top);
        return width <= 1 && height <= 1;
    }

    public static bool DirectChildHiddenOrMissing(IntPtr parent, string className)
    {
        foreach (IntPtr child in DirectChildren(parent))
        {
            if (String.Equals(ClassName(child), className, StringComparison.Ordinal))
            {
                return !IsWindowVisible(child);
            }
        }
        return true;
    }

    public static string SurfaceState(IntPtr parent, string className)
    {
        List<IntPtr> children = DirectChildren(parent);
        int hostIndex = -1;
        int lastPanelIndex = -1;
        IntPtr host = IntPtr.Zero;
        for (int index = 0; index < children.Count; index += 1)
        {
            string currentClass = ClassName(children[index]);
            if (String.Equals(currentClass, className, StringComparison.Ordinal))
            {
                hostIndex = index;
                host = children[index];
            }
            if (String.Equals(currentClass, "HomePanelNativeStaticPanel", StringComparison.Ordinal))
            {
                lastPanelIndex = index;
            }
        }
        if (host == IntPtr.Zero) return "missing";
        RECT rect;
        if (!GetWindowRect(host, out rect)) return "rect-error";
        return String.Format(
            "visible={0};width={1};height={2};zIndex={3};lastPanelIndex={4};belowPanels={5}",
            IsWindowVisible(host),
            Math.Max(0, rect.Right - rect.Left),
            Math.Max(0, rect.Bottom - rect.Top),
            hostIndex,
            lastPanelIndex,
            hostIndex > lastPanelIndex);
    }

    public static string ForegroundClass()
    {
        IntPtr foreground = GetForegroundWindow();
        return foreground == IntPtr.Zero ? "" : ClassName(foreground);
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
  secondaryStationheadUrlNavigated = "Stationhead B navigation (startup): https://www.stationhead.com/sakuramankai"
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

$process = $null
$startedAtUtc = [DateTime]::UtcNow
$mainWindow = [IntPtr]::Zero
$monitoringStartedAtUtc = $null
$firstSurfaceObservationAtUtc = $null
$postClickObserveUntilUtc = $null
$sampleCount = 0
$primaryHostSeen = $false
$secondaryHostSeen = $false
$primaryInteractiveAuthObserved = $false
$secondaryInteractiveAuthObserved = $false
$primaryUnexpectedForegroundSamples = 0
$secondaryUnexpectedForegroundSamples = 0
$interactiveAuthSignalGraceSamples = 40
$violation = $null
$failureMessage = $null
$lastPrimaryState = "unobserved"
$lastSecondaryState = "unobserved"
$lastPrimaryAuthHidden = $true
$lastSecondaryAuthHidden = $true

try {
  Write-Host "Starting observational native Stationhead startup smoke: $executablePath"
  $process = Start-Process -FilePath $executablePath -WorkingDirectory $workingDirectory -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

  while ([DateTime]::UtcNow -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) {
      throw "HomePanel exited before Stationhead startup smoke completed with code $($process.ExitCode)."
    }

    if ($mainWindow -eq [IntPtr]::Zero) {
      $mainWindow = [HomePanelStationheadObserveNative]::FindTopLevelWindow(
        $process.Id, "HomePanelNativeWindow")
    }

    $log = ""
    if (Test-Path -LiteralPath $logPath) {
      $log = [string](Get-Content -LiteralPath $logPath -Raw -ErrorAction SilentlyContinue)
      foreach ($name in $required.Keys) {
        if (-not $observed[$name] -and $log.Contains($required[$name])) {
          $elapsedMs = [int][Math]::Round(
            ([DateTime]::UtcNow - $startedAtUtc).TotalMilliseconds)
          $observed[$name] = $true
          $observedAtMs[$name] = $elapsedMs
          Write-Host "Observed $name at ${elapsedMs}ms"
        }
      }
      if ($log.Contains("Stationhead A login required; window visible") -or
          $log.Contains("Stationhead A audio-loss state=auth_wait detail=authentication surface detected (")) {
        $primaryInteractiveAuthObserved = $true
      }
      if ($log.Contains("Stationhead B login required; window visible") -or
          $log.Contains("Stationhead B audio-loss state=auth_wait detail=authentication surface detected (")) {
        $secondaryInteractiveAuthObserved = $true
      }
    }

    if ($mainWindow -ne [IntPtr]::Zero) {
      $sampleCount += 1
      $primaryHostSeen = $primaryHostSeen -or
        [HomePanelStationheadObserveNative]::HasDirectChild(
          $mainWindow, "HomePanelStationheadHost")
      $secondaryHostSeen = $secondaryHostSeen -or
        [HomePanelStationheadObserveNative]::HasDirectChild(
          $mainWindow, "HomePanelSecondaryStationheadHost")
      if (($primaryHostSeen -or $secondaryHostSeen) -and -not $firstSurfaceObservationAtUtc) {
        $firstSurfaceObservationAtUtc = [DateTime]::UtcNow
        Write-Host "Started non-mutating Stationhead surface observation at first host creation."
      }

      $primaryBackgroundSafe = [HomePanelStationheadObserveNative]::PlaybackStartupSafe(
        $mainWindow, "HomePanelStationheadHost")
      $secondaryBackgroundSafe = [HomePanelStationheadObserveNative]::PlaybackStartupSafe(
        $mainWindow, "HomePanelSecondaryStationheadHost")

      if ($primaryBackgroundSafe -or $primaryInteractiveAuthObserved) {
        $primaryUnexpectedForegroundSamples = 0
        $primaryStartupSafe = $true
      } else {
        $primaryUnexpectedForegroundSamples += 1
        $primaryStartupSafe =
          $primaryUnexpectedForegroundSamples -le $interactiveAuthSignalGraceSamples
      }
      if ($secondaryBackgroundSafe -or $secondaryInteractiveAuthObserved) {
        $secondaryUnexpectedForegroundSamples = 0
        $secondaryStartupSafe = $true
      } else {
        $secondaryUnexpectedForegroundSamples += 1
        $secondaryStartupSafe =
          $secondaryUnexpectedForegroundSamples -le $interactiveAuthSignalGraceSamples
      }

      $lastPrimaryAuthHidden = [HomePanelStationheadObserveNative]::DirectChildHiddenOrMissing(
        $mainWindow, "HomePanelSpotifyAuthHost")
      $lastSecondaryAuthHidden = [HomePanelStationheadObserveNative]::DirectChildHiddenOrMissing(
        $mainWindow, "HomePanelSecondarySpotifyAuthHost")
      $lastPrimaryState = [HomePanelStationheadObserveNative]::SurfaceState(
        $mainWindow, "HomePanelStationheadHost")
      $lastSecondaryState = [HomePanelStationheadObserveNative]::SurfaceState(
        $mainWindow, "HomePanelSecondaryStationheadHost")

      if (-not $primaryStartupSafe -or -not $secondaryStartupSafe -or
          -not $lastPrimaryAuthHidden -or -not $lastSecondaryAuthHidden) {
        $violation = [ordered]@{
          phase = "startup"
          observedAtUtc = [DateTime]::UtcNow.ToString("o")
          elapsedMs = [int][Math]::Round(
            ([DateTime]::UtcNow - $startedAtUtc).TotalMilliseconds)
          primaryPlayback = $lastPrimaryState
          secondaryPlayback = $lastSecondaryState
          primaryInteractiveAuth = $primaryInteractiveAuthObserved
          secondaryInteractiveAuth = $secondaryInteractiveAuthObserved
          primaryUnexpectedForegroundSamples = $primaryUnexpectedForegroundSamples
          secondaryUnexpectedForegroundSamples = $secondaryUnexpectedForegroundSamples
          primaryAuthHidden = $lastPrimaryAuthHidden
          secondaryAuthHidden = $lastSecondaryAuthHidden
          foregroundClass = [HomePanelStationheadObserveNative]::ForegroundClass()
        }
        throw "Stationhead startup invariant failed: A=[$lastPrimaryState] B=[$lastSecondaryState] interactiveAuth=$primaryInteractiveAuthObserved/$secondaryInteractiveAuthObserved authHidden=$lastPrimaryAuthHidden/$lastSecondaryAuthHidden"
      }

      $nativePanelsReady =
        [HomePanelStationheadObserveNative]::NativePanelCount($mainWindow) -ge 3
      $dashboardReady = $log.Contains("Native dashboard started")
      if (-not $monitoringStartedAtUtc -and $nativePanelsReady -and $dashboardReady) {
        $monitoringStartedAtUtc = [DateTime]::UtcNow
        Write-Host "Started non-mutating foreground monitoring after native dashboard readiness."
      }

      if ($monitoringStartedAtUtc) {
        $primaryOk =
          [HomePanelStationheadObserveNative]::PlaybackBehindNativePanels(
            $mainWindow, "HomePanelStationheadHost") -or
          $primaryInteractiveAuthObserved -or
          ($primaryUnexpectedForegroundSamples -gt 0 -and
           $primaryUnexpectedForegroundSamples -le $interactiveAuthSignalGraceSamples)
        $secondaryOk =
          [HomePanelStationheadObserveNative]::PlaybackBehindNativePanels(
            $mainWindow, "HomePanelSecondaryStationheadHost") -or
          $secondaryInteractiveAuthObserved -or
          ($secondaryUnexpectedForegroundSamples -gt 0 -and
           $secondaryUnexpectedForegroundSamples -le $interactiveAuthSignalGraceSamples)
        if (-not $primaryOk -or -not $secondaryOk -or
            -not $lastPrimaryAuthHidden -or -not $lastSecondaryAuthHidden) {
          $violation = [ordered]@{
            phase = "dashboard"
            observedAtUtc = [DateTime]::UtcNow.ToString("o")
            elapsedMs = [int][Math]::Round(
              ([DateTime]::UtcNow - $startedAtUtc).TotalMilliseconds)
            primaryPlayback = $lastPrimaryState
            secondaryPlayback = $lastSecondaryState
            primaryInteractiveAuth = $primaryInteractiveAuthObserved
            secondaryInteractiveAuth = $secondaryInteractiveAuthObserved
            primaryUnexpectedForegroundSamples = $primaryUnexpectedForegroundSamples
            secondaryUnexpectedForegroundSamples = $secondaryUnexpectedForegroundSamples
            primaryAuthHidden = $lastPrimaryAuthHidden
            secondaryAuthHidden = $lastSecondaryAuthHidden
            foregroundClass = [HomePanelStationheadObserveNative]::ForegroundClass()
          }
          throw "Stationhead foreground invariant failed: A=[$lastPrimaryState] B=[$lastSecondaryState] interactiveAuth=$primaryInteractiveAuthObserved/$secondaryInteractiveAuthObserved authHidden=$lastPrimaryAuthHidden/$lastSecondaryAuthHidden"
        }
      }
    }

    $missing = @($required.Keys | Where-Object { -not $observed[$_] })
    if ($missing.Count -eq 0 -and $monitoringStartedAtUtc -and
        $primaryHostSeen -and $secondaryHostSeen) {
      if ($null -eq $postClickObserveUntilUtc) {
        $startupElapsedMs = [Math]::Max(
          [int]$observedAtMs.primaryStartListeningClickRequested,
          [int]$observedAtMs.secondaryStartListeningClickRequested)
        if ($startupElapsedMs -gt ($StartupBudgetSeconds * 1000)) {
          throw "Native Stationhead startup exceeded the ${StartupBudgetSeconds}s budget (${startupElapsedMs}ms)."
        }
        $postClickObserveUntilUtc = [DateTime]::UtcNow.AddSeconds($PostClickSettleSeconds)
        Write-Host "Continuing invariant monitoring for ${PostClickSettleSeconds}s after both startup clicks."
      } elseif ([DateTime]::UtcNow -ge $postClickObserveUntilUtc) {
        break
      }
    }

    Start-Sleep -Milliseconds 25
  }

  $missing = @($required.Keys | Where-Object { -not $observed[$_] })
  if ($missing.Count -ne 0) {
    throw "Native Stationhead startup did not reach: $($missing -join ', ')."
  }
  if (-not $monitoringStartedAtUtc) {
    throw "Native dashboard never became ready for foreground-invariant monitoring."
  }
  if (-not $primaryHostSeen -or -not $secondaryHostSeen -or
      -not $firstSurfaceObservationAtUtc) {
    throw "Both Stationhead hosts were not observed from their creation phase."
  }
  if ($null -eq $postClickObserveUntilUtc -or
      [DateTime]::UtcNow -lt $postClickObserveUntilUtc) {
    throw "The post-click foreground observation window did not complete."
  }

  Write-Host "Observational native Stationhead startup smoke passed with $sampleCount samples."
} catch {
  $failureMessage = $_.Exception.Message
} finally {
  if ($process) {
    $process.Refresh()
    if (-not $process.HasExited) {
      Save-DesktopScreenshot
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(5000) | Out-Null
    }
  }
  if (Test-Path -LiteralPath $logPath) {
    Copy-Item -LiteralPath $logPath -Destination $copiedLogPath -Force -ErrorAction SilentlyContinue
  }

  [ordered]@{
    executable = $executablePath
    processId = if ($process) { $process.Id } else { $null }
    startedAtUtc = $startedAtUtc.ToString("o")
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
    monitoringStartedAtUtc = if ($monitoringStartedAtUtc) {
      $monitoringStartedAtUtc.ToString("o")
    } else {
      $null
    }
    firstSurfaceObservationAtUtc = if ($firstSurfaceObservationAtUtc) {
      $firstSurfaceObservationAtUtc.ToString("o")
    } else {
      $null
    }
    primaryHostSeen = $primaryHostSeen
    secondaryHostSeen = $secondaryHostSeen
    primaryInteractiveAuthObserved = $primaryInteractiveAuthObserved
    secondaryInteractiveAuthObserved = $secondaryInteractiveAuthObserved
    primaryUnexpectedForegroundSamples = $primaryUnexpectedForegroundSamples
    secondaryUnexpectedForegroundSamples = $secondaryUnexpectedForegroundSamples
    interactiveAuthSignalGraceSamples = $interactiveAuthSignalGraceSamples
    observationalOnly = $true
    forbiddenWindowMutationApisChecked = $forbiddenMutationNames
    sampleIntervalMs = 25
    sampleCount = $sampleCount
    postClickObservationSeconds = $PostClickSettleSeconds
    observed = $observed
    observedAtMs = $observedAtMs
    finalPrimaryPlayback = $lastPrimaryState
    finalSecondaryPlayback = $lastSecondaryState
    finalPrimaryAuthHidden = $lastPrimaryAuthHidden
    finalSecondaryAuthHidden = $lastSecondaryAuthHidden
    violation = $violation
    failure = $failureMessage
    passed = [string]::IsNullOrEmpty($failureMessage)
  } | ConvertTo-Json -Depth 8 |
    Set-Content -LiteralPath $resultPath -Encoding utf8
}

if (-not [string]::IsNullOrEmpty($failureMessage)) {
  throw $failureMessage
}