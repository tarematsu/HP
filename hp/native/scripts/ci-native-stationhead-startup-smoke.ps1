[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,

  [int]$TimeoutSeconds = 210,

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
# an application window. A source-level self-audit prevents the previous false
# positive from being reintroduced under another helper name.
$scriptSource = Get-Content -LiteralPath $PSCommandPath -Raw
$forbiddenMutationNames = @(
  ('Set' + 'WindowPos'),
  ('Move' + 'Window'),
  ('Show' + 'Window'),
  ('Set' + 'ForegroundWindow'),
  ('Bring' + 'WindowToTop'),
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
$monitorLogOffset = 0
$sampleCount = 0
$switchedRole = $null
$switchLogIndex = -1
$switchObservedAtMs = $null
$switchedClickObservedAtMs = $null
$postSwitchObserveUntilUtc = $null
$violation = $null
$failureMessage = $null
$lastPrimaryState = "unobserved"
$lastSecondaryState = "unobserved"
$lastPrimaryAuthHidden = $true
$lastSecondaryAuthHidden = $true

try {
  Write-Host "Starting observational native Stationhead background smoke: $executablePath"
  $process = Start-Process -FilePath $executablePath -WorkingDirectory $workingDirectory -PassThru
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

  while ([DateTime]::UtcNow -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) {
      throw "HomePanel exited before Stationhead background smoke completed with code $($process.ExitCode)."
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
    }

    $nativePanelsReady = $mainWindow -ne [IntPtr]::Zero -and
      [HomePanelStationheadObserveNative]::NativePanelCount($mainWindow) -ge 3
    $dashboardReady = $log.Contains("Native dashboard started")
    if (-not $monitoringStartedAtUtc -and $nativePanelsReady -and $dashboardReady) {
      $monitoringStartedAtUtc = [DateTime]::UtcNow
      $monitorLogOffset = $log.Length
      Write-Host "Started non-mutating foreground monitoring after native dashboard readiness."
    }

    if ($monitoringStartedAtUtc) {
      $sampleCount += 1
      $primaryOk = [HomePanelStationheadObserveNative]::PlaybackBehindNativePanels(
        $mainWindow, "HomePanelStationheadHost")
      $secondaryOk = [HomePanelStationheadObserveNative]::PlaybackBehindNativePanels(
        $mainWindow, "HomePanelSecondaryStationheadHost")
      $lastPrimaryAuthHidden = [HomePanelStationheadObserveNative]::DirectChildHiddenOrMissing(
        $mainWindow, "HomePanelSpotifyAuthHost")
      $lastSecondaryAuthHidden = [HomePanelStationheadObserveNative]::DirectChildHiddenOrMissing(
        $mainWindow, "HomePanelSecondarySpotifyAuthHost")
      $lastPrimaryState = [HomePanelStationheadObserveNative]::SurfaceState(
        $mainWindow, "HomePanelStationheadHost")
      $lastSecondaryState = [HomePanelStationheadObserveNative]::SurfaceState(
        $mainWindow, "HomePanelSecondaryStationheadHost")

      if (-not $primaryOk -or -not $secondaryOk -or
          -not $lastPrimaryAuthHidden -or -not $lastSecondaryAuthHidden) {
        $violation = [ordered]@{
          observedAtUtc = [DateTime]::UtcNow.ToString("o")
          elapsedMs = [int][Math]::Round(
            ([DateTime]::UtcNow - $startedAtUtc).TotalMilliseconds)
          primaryPlayback = $lastPrimaryState
          secondaryPlayback = $lastSecondaryState
          primaryAuthHidden = $lastPrimaryAuthHidden
          secondaryAuthHidden = $lastSecondaryAuthHidden
          foregroundClass = [HomePanelStationheadObserveNative]::ForegroundClass()
        }
        throw "Stationhead foreground invariant failed: A=[$lastPrimaryState] B=[$lastSecondaryState] authHidden=$lastPrimaryAuthHidden/$lastSecondaryAuthHidden"
      }

      $monitoredLog = if ($log.Length -gt $monitorLogOffset) {
        $log.Substring($monitorLogOffset)
      } else {
        ""
      }
      if (-not $switchedRole) {
        foreach ($role in $clockSwitchMarkers.Keys) {
          $candidateIndex = $monitoredLog.IndexOf($clockSwitchMarkers[$role])
          if ($candidateIndex -ge 0) {
            $switchedRole = $role
            $switchLogIndex = $monitorLogOffset + $candidateIndex
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
          $postSwitchObserveUntilUtc = [DateTime]::UtcNow.AddSeconds($PostClickSettleSeconds)
          Write-Host "Observed post-switch Start Listening click for Window $switchedRole at ${switchedClickObservedAtMs}ms"
          Write-Host "Continuing invariant monitoring for ${PostClickSettleSeconds}s after the click."
        }
      }

      $missing = @($required.Keys | Where-Object { -not $observed[$_] })
      if ($missing.Count -eq 0 -and $switchedRole -and
          $null -ne $postSwitchObserveUntilUtc -and
          [DateTime]::UtcNow -ge $postSwitchObserveUntilUtc) {
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
  if (-not $switchedRole) {
    throw "No even-minute A or odd-minute B destination switch was observed after monitoring began."
  }
  if ($null -eq $switchedClickObservedAtMs) {
    throw "Window $switchedRole did not request Start Listening after its clock destination switch."
  }
  if ($null -eq $postSwitchObserveUntilUtc -or
      [DateTime]::UtcNow -lt $postSwitchObserveUntilUtc) {
    throw "The post-switch foreground observation window did not complete."
  }

  $startupElapsedMs = [Math]::Max(
    [int]$observedAtMs.primaryStartListeningClickRequested,
    [int]$observedAtMs.secondaryStartListeningClickRequested)
  if ($startupElapsedMs -gt ($StartupBudgetSeconds * 1000)) {
    throw "Native Stationhead startup exceeded the ${StartupBudgetSeconds}s budget (${startupElapsedMs}ms)."
  }

  Write-Host "Observational native Stationhead background smoke passed with $sampleCount samples."
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
    observationalOnly = $true
    forbiddenWindowMutationApisChecked = $forbiddenMutationNames
    sampleIntervalMs = 25
    sampleCount = $sampleCount
    postClickObservationSeconds = $PostClickSettleSeconds
    observed = $observed
    observedAtMs = $observedAtMs
    switchedRole = $switchedRole
    switchObservedAtMs = $switchObservedAtMs
    switchedClickObservedAtMs = $switchedClickObservedAtMs
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
