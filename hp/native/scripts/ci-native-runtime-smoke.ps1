[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Executable,

  [int]$DashboardTimeoutSeconds = 55,

  [int]$ActionDelayMilliseconds = 1250,

  [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$workingDirectory = Split-Path -Parent $executablePath
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $workingDirectory "ci-runtime-smoke"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)

Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null

# Use an isolated profile on every run. The test intentionally does not require
# Stationhead audio playback; the production 30-second no-audio fallback opens
# the native dashboard, after which the native A/B and MUTE actions are tested.
$dataDirectory = Join-Path $workingDirectory "data"
Remove-Item -LiteralPath $dataDirectory -Recurse -Force -ErrorAction SilentlyContinue

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class HomePanelSmokeNativeMethods
{
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumChildWindows(
        IntPtr parent, EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(
        IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(
        IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(
        IntPtr window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostMessage(
        IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

    private static string ClassName(IntPtr window)
    {
        var text = new StringBuilder(256);
        return GetClassName(window, text, text.Capacity) > 0
            ? text.ToString()
            : String.Empty;
    }

    private static string WindowText(IntPtr window)
    {
        var text = new StringBuilder(512);
        return GetWindowText(window, text, text.Capacity) > 0
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

    public static string[] ChildWindowTexts(IntPtr parent, string className)
    {
        var results = new List<string>();
        EnumChildWindows(parent, (window, parameter) =>
        {
            if (String.Equals(ClassName(window), className, StringComparison.Ordinal))
            {
                results.Add(WindowText(window));
            }
            return true;
        }, IntPtr.Zero);
        return results.ToArray();
    }
}
'@

function Assert-ProcessAlive {
  param(
    [Parameter(Mandatory = $true)]
    [System.Diagnostics.Process]$Process,

    [Parameter(Mandatory = $true)]
    [string]$Stage
  )

  $Process.Refresh()
  if ($Process.HasExited) {
    throw "HomePanel exited during '$Stage' with code $($Process.ExitCode)."
  }
}

function Save-ApplicationEvents {
  param([datetime]$StartedAt)

  $eventPath = Join-Path $OutputDirectory "application-errors.txt"
  $events = @(
    Get-WinEvent -FilterHashtable @{
      LogName = "Application"
      StartTime = $StartedAt.AddSeconds(-2)
      Level = 2
    } -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Message -match "(?i)HomePanel(?:Updater)?\.exe"
      }
  )

  if ($events.Count -eq 0) {
    "No HomePanel application-error events." | Set-Content -LiteralPath $eventPath -Encoding utf8
  } else {
    $events |
      Format-List TimeCreated, ProviderName, Id, LevelDisplayName, Message |
      Out-String -Width 240 |
      Set-Content -LiteralPath $eventPath -Encoding utf8
  }
  return $events
}

$process = $null
$startedAt = Get-Date
$logPath = Join-Path $dataDirectory "homepanel.log"
$copiedLogPath = Join-Path $OutputDirectory "homepanel.log"

try {
  Write-Host "Starting native runtime smoke test: $executablePath"
  Write-Host "Stationhead playback is intentionally excluded from pass/fail criteria."

  $process = Start-Process `
    -FilePath $executablePath `
    -WorkingDirectory $workingDirectory `
    -PassThru

  $mainWindow = [IntPtr]::Zero
  $mainWindowDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $mainWindowDeadline) {
    Assert-ProcessAlive -Process $process -Stage "main-window creation"
    $mainWindow = [HomePanelSmokeNativeMethods]::FindTopLevelWindow(
      $process.Id, "HomePanelNativeWindow")
    if ($mainWindow -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($mainWindow -eq [IntPtr]::Zero) {
    throw "HomePanelNativeWindow was not created within 15 seconds."
  }
  Write-Host "Main native HWND created: $mainWindow"

  $requiredPanels = @(
    "HomePanelNativeRadar",
    "HomePanelNativeSide",
    "HomePanelNativeMain"
  )
  $panelDeadline = [DateTime]::UtcNow.AddSeconds($DashboardTimeoutSeconds)
  $panelTexts = @()
  while ([DateTime]::UtcNow -lt $panelDeadline) {
    Assert-ProcessAlive -Process $process -Stage "native-dashboard initialization"
    $panelTexts = @(
      [HomePanelSmokeNativeMethods]::ChildWindowTexts(
        $mainWindow, "HomePanelNativeStaticPanel")
    )
    $missing = @($requiredPanels | Where-Object { $_ -notin $panelTexts })
    if ($missing.Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }

  $missing = @($requiredPanels | Where-Object { $_ -notin $panelTexts })
  if ($missing.Count -ne 0) {
    throw "Native dashboard panels were not created: $($missing -join ', ')."
  }
  Write-Host "Native dashboard panels created: $($panelTexts -join ', ')"

  # WM_APP + 11 is kRendererActionMessage. UiAction values 3 and 4 are
  # StationheadAudioToggle and StationheadAudioMute respectively.
  $rendererActionMessage = [uint32](0x8000 + 11)
  $actions = @(
    @{ Name = "select B audio"; Value = 3 },
    @{ Name = "mute audio"; Value = 4 },
    @{ Name = "select A audio"; Value = 3 }
  )

  foreach ($action in $actions) {
    Assert-ProcessAlive -Process $process -Stage $action.Name
    $posted = [HomePanelSmokeNativeMethods]::PostMessage(
      $mainWindow,
      $rendererActionMessage,
      [UIntPtr]([uint64]$action.Value),
      [IntPtr]::Zero)
    if (-not $posted) {
      throw "PostMessage failed for '$($action.Name)' (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
    }
    Start-Sleep -Milliseconds $ActionDelayMilliseconds
    Assert-ProcessAlive -Process $process -Stage "$($action.Name) completion"
  }

  # Close through the normal WM_CLOSE path and require a clean zero exit code.
  if (-not [HomePanelSmokeNativeMethods]::PostMessage(
      $mainWindow, [uint32]0x0010, [UIntPtr]::Zero, [IntPtr]::Zero)) {
    throw "Failed to post WM_CLOSE to HomePanel."
  }
  if (-not $process.WaitForExit(15000)) {
    throw "HomePanel did not exit within 15 seconds after WM_CLOSE."
  }
  if ($process.ExitCode -ne 0) {
    throw "HomePanel returned non-zero exit code $($process.ExitCode)."
  }

  if (Test-Path -LiteralPath $logPath) {
    Copy-Item -LiteralPath $logPath -Destination $copiedLogPath -Force
  } else {
    throw "HomePanel did not create data/homepanel.log."
  }

  $log = Get-Content -LiteralPath $logPath -Raw
  foreach ($requiredLog in @(
    "Stationhead A registering required startup scripts",
    "Stationhead B registering required startup scripts",
    "Native dashboard started after",
    "HomePanel exiting code 0"
  )) {
    if (-not $log.Contains($requiredLog)) {
      throw "Required runtime evidence is missing from the log: '$requiredLog'."
    }
  }

  if ($log -match "(?im)Unhandled exception|std::terminate|native dashboard callback failed|HomePanel exiting code [1-9]") {
    throw "HomePanel log contains a fatal runtime marker."
  }

  $applicationErrors = @(Save-ApplicationEvents -StartedAt $startedAt)
  if ($applicationErrors.Count -ne 0) {
    throw "Windows Application log contains HomePanel error events."
  }

  [ordered]@{
    executable = $executablePath
    processId = $process.Id
    exitCode = $process.ExitCode
    playbackRequired = $false
    nativePanels = $panelTexts
    actions = @($actions | ForEach-Object { $_.Name })
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $OutputDirectory "result.json") -Encoding utf8

  Write-Host "Native runtime smoke test passed."
} catch {
  if ($process) {
    $process.Refresh()
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(5000) | Out-Null
    }
  }

  if (Test-Path -LiteralPath $logPath) {
    Copy-Item -LiteralPath $logPath -Destination $copiedLogPath -Force -ErrorAction SilentlyContinue
    Write-Host "----- HomePanel log -----"
    Get-Content -LiteralPath $logPath -ErrorAction SilentlyContinue | Write-Host
  }
  Save-ApplicationEvents -StartedAt $startedAt | Out-Null
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $OutputDirectory "failure.txt") -Encoding utf8
  throw
}
