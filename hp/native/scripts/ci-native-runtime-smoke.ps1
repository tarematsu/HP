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

$dataDirectory = Join-Path $workingDirectory "data"
Remove-Item -LiteralPath $dataDirectory -Recurse -Force -ErrorAction SilentlyContinue
$logPath = Join-Path $dataDirectory "homepanel.log"

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
    private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr window, StringBuilder text, int maximumCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

    private static string ClassName(IntPtr window)
    {
        var text = new StringBuilder(256);
        return GetClassName(window, text, text.Capacity) > 0 ? text.ToString() : String.Empty;
    }

    private static string WindowText(IntPtr window)
    {
        var text = new StringBuilder(512);
        return GetWindowText(window, text, text.Capacity) > 0 ? text.ToString() : String.Empty;
    }

    public static IntPtr FindTopLevelWindow(int processId, string className)
    {
        IntPtr result = IntPtr.Zero;
        EnumWindows((window, parameter) =>
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == (uint)processId && String.Equals(ClassName(window), className, StringComparison.Ordinal))
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
            if (String.Equals(ClassName(window), className, StringComparison.Ordinal)) results.Add(WindowText(window));
            return true;
        }, IntPtr.Zero);
        return results.ToArray();
    }
}
'@

function Assert-ProcessAlive {
  param([System.Diagnostics.Process]$Process, [string]$Stage)
  $Process.Refresh()
  if ($Process.HasExited) {
    throw "HomePanel exited during '$Stage' with code $($Process.ExitCode)."
  }
}

function Get-ApplicationErrors {
  param([datetime]$StartedAt)
  @(
    Get-WinEvent -FilterHashtable @{
      LogName = "Application"
      StartTime = $StartedAt.AddSeconds(-2)
      Level = 2
    } -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -match "(?i)HomePanel(?:Updater)?\.exe" }
  )
}

$process = $null
$startedAt = Get-Date
try {
  $process = Start-Process -FilePath $executablePath -WorkingDirectory $workingDirectory -PassThru

  $mainWindow = [IntPtr]::Zero
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline) {
    Assert-ProcessAlive -Process $process -Stage "main-window creation"
    $mainWindow = [HomePanelSmokeNativeMethods]::FindTopLevelWindow($process.Id, "HomePanelNativeWindow")
    if ($mainWindow -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($mainWindow -eq [IntPtr]::Zero) { throw "HomePanelNativeWindow was not created within 15 seconds." }

  $requiredPanels = @("HomePanelNativeMedia", "HomePanelNativeSide", "HomePanelNativeMain")
  $panelDeadline = [DateTime]::UtcNow.AddSeconds($DashboardTimeoutSeconds)
  $panelTexts = @()
  while ([DateTime]::UtcNow -lt $panelDeadline) {
    Assert-ProcessAlive -Process $process -Stage "native-dashboard initialization"
    $panelTexts = @([HomePanelSmokeNativeMethods]::ChildWindowTexts($mainWindow, "HomePanelNativeStaticPanel"))
    if (@($requiredPanels | Where-Object { $_ -notin $panelTexts }).Count -eq 0) { break }
    Start-Sleep -Milliseconds 500
  }
  $missing = @($requiredPanels | Where-Object { $_ -notin $panelTexts })
  if ($missing.Count -ne 0) { throw "Native dashboard panels were not created: $($missing -join ', ')." }

  $rendererActionMessage = [uint32](0x8000 + 22)
  foreach ($action in @(
      @{ Name = "select B audio"; Value = 3 },
      @{ Name = "mute audio"; Value = 4 },
      @{ Name = "select A audio"; Value = 3 })) {
    Assert-ProcessAlive -Process $process -Stage $action.Name
    if (-not [HomePanelSmokeNativeMethods]::PostMessage(
        $mainWindow, $rendererActionMessage, [UIntPtr]([uint64]$action.Value), [IntPtr]::Zero)) {
      throw "PostMessage failed for '$($action.Name)'."
    }
    Start-Sleep -Milliseconds $ActionDelayMilliseconds
    Assert-ProcessAlive -Process $process -Stage "$($action.Name) completion"
  }

  if (-not [HomePanelSmokeNativeMethods]::PostMessage(
      $mainWindow, [uint32]0x0112, [UIntPtr]([uint64]0xF060), [IntPtr]::Zero)) {
    throw "Failed to post SC_CLOSE to HomePanel."
  }
  if (-not $process.WaitForExit(15000)) { throw "HomePanel did not exit within 15 seconds after SC_CLOSE." }
  if ($process.ExitCode -ne 0) { throw "HomePanel returned non-zero exit code $($process.ExitCode)." }

  if (Test-Path -LiteralPath $logPath) {
    throw "HomePanel unexpectedly created data/homepanel.log; runtime file logging must remain disabled."
  }

  $applicationErrors = @(Get-ApplicationErrors -StartedAt $startedAt)
  if ($applicationErrors.Count -ne 0) {
    throw "Windows Application log contains HomePanel error events."
  }

  [ordered]@{
    executable = $executablePath
    exitCode = $process.ExitCode
    runtimeFileLoggingDisabled = $true
    nativePanels = $panelTexts
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 4 |
    Set-Content -LiteralPath (Join-Path $OutputDirectory "result.json") -Encoding utf8

  Write-Host "Native runtime smoke test passed without runtime file logging."
} catch {
  if ($process) {
    $process.Refresh()
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      $process.WaitForExit(5000) | Out-Null
    }
  }
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $OutputDirectory "failure.txt") -Encoding utf8
  throw
}
