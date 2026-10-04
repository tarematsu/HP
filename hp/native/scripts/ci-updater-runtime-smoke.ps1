[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$HomePanelExecutable,
  [Parameter(Mandatory = $true)][string]$UpdaterExecutable,
  [Parameter(Mandatory = $true)][string]$WebView2Loader,
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$ConfigExample,
  [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$homePanelSource = (Resolve-Path -LiteralPath $HomePanelExecutable).Path
$updaterSource = (Resolve-Path -LiteralPath $UpdaterExecutable).Path
$loaderSource = (Resolve-Path -LiteralPath $WebView2Loader).Path
$configSource = if ($ConfigExample) { (Resolve-Path -LiteralPath $ConfigExample).Path } else { $null }
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path (Split-Path -Parent $updaterSource) "ci-updater-runtime-smoke"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$temporaryBase = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$installRoot = Join-Path $temporaryBase ("homepanel-updater-smoke-" + [Guid]::NewGuid().ToString("N"))
$dataDirectory = Join-Path $installRoot "data"
$manifestPath = Join-Path $dataDirectory "pending-update.json"
$updaterLogPath = Join-Path $dataDirectory "homepanel-updater.log"
$homePanelLogPath = Join-Path $dataDirectory "homepanel.log"

Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $OutputDirectory, $installRoot, $dataDirectory | Out-Null
Copy-Item -LiteralPath $homePanelSource -Destination (Join-Path $installRoot "HomePanel.exe") -Force
Copy-Item -LiteralPath $updaterSource -Destination (Join-Path $installRoot "HomePanelUpdater.exe") -Force
Copy-Item -LiteralPath $loaderSource -Destination (Join-Path $installRoot "WebView2Loader.dll") -Force
if ($configSource) { Copy-Item -LiteralPath $configSource -Destination (Join-Path $installRoot "config.example.json") -Force }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class HomePanelUpdaterSmokeNativeMethods
{
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool PostMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

    private static string ClassName(IntPtr window)
    {
        var text = new StringBuilder(256);
        return GetClassName(window, text, text.Capacity) > 0 ? text.ToString() : String.Empty;
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
}
'@

function Get-FileState {
  param([Parameter(Mandatory = $true)][string]$Path)
  $item = Get-Item -LiteralPath $Path
  [ordered]@{
    name = $item.Name
    path = $item.FullName
    size = [int64]$item.Length
    sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Find-InstalledHomePanel {
  param([Parameter(Mandatory = $true)][string]$ExecutablePath)
  $expected = [System.IO.Path]::GetFullPath($ExecutablePath)
  $found = Get-CimInstance Win32_Process -Filter "Name = 'HomePanel.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and [String]::Equals(
        [System.IO.Path]::GetFullPath($_.ExecutablePath), $expected,
        [StringComparison]::OrdinalIgnoreCase)
    } | Select-Object -First 1
  if (-not $found) { return $null }
  Get-Process -Id ([int]$found.ProcessId) -ErrorAction SilentlyContinue
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

$installedPaths = @(
  (Join-Path $installRoot "HomePanel.exe"),
  (Join-Path $installRoot "HomePanelUpdater.exe"),
  (Join-Path $installRoot "WebView2Loader.dll")
)
$before = @($installedPaths | ForEach-Object { Get-FileState -Path $_ })
[ordered]@{
  version = $Version
  signed = $false
  files = @($before | ForEach-Object {
    [ordered]@{
      name = $_.name
      url = "https://updates.invalid/$($_.name)"
      sha256 = $_.sha256
      size = $_.size
      requireAuthenticode = $false
    }
  })
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM

$updaterPath = Join-Path $installRoot "HomePanelUpdater.exe"
$homePanelPath = Join-Path $installRoot "HomePanel.exe"
$updaterProcess = $null
$homePanelProcess = $null
$homePanelExitCode = $null
$startedAt = Get-Date

try {
  $updaterProcess = Start-Process -FilePath $updaterPath -ArgumentList @(
    "--pid", [string]$PID,
    "--app-pid", [string]$PID,
    "--root", $installRoot,
    "--manifest", $manifestPath,
    "--version", $Version
  ) -WorkingDirectory $installRoot -PassThru

  if (-not $updaterProcess.WaitForExit(60000)) {
    Stop-Process -Id $updaterProcess.Id -Force -ErrorAction SilentlyContinue
    throw "HomePanelUpdater did not finish within 60 seconds."
  }
  if ($updaterProcess.ExitCode -ne 0) { throw "HomePanelUpdater returned exit code $($updaterProcess.ExitCode)." }
  if (Test-Path -LiteralPath $manifestPath) { throw "HomePanelUpdater did not remove the verified pending manifest." }

  $after = @($installedPaths | ForEach-Object { Get-FileState -Path $_ })
  for ($index = 0; $index -lt $before.Count; $index++) {
    if ($before[$index].size -ne $after[$index].size -or $before[$index].sha256 -ne $after[$index].sha256) {
      throw "Same-version verification unexpectedly modified $($before[$index].name)."
    }
  }

  if (Test-Path -LiteralPath $updaterLogPath) {
    throw "HomePanelUpdater unexpectedly created data/homepanel-updater.log."
  }

  $restartDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $restartDeadline) {
    $homePanelProcess = Find-InstalledHomePanel -ExecutablePath $homePanelPath
    if ($homePanelProcess) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $homePanelProcess) { throw "HomePanelUpdater did not restart HomePanel.exe." }

  $mainWindow = [IntPtr]::Zero
  $windowDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $windowDeadline) {
    $homePanelProcess.Refresh()
    if ($homePanelProcess.HasExited) { throw "Restarted HomePanel exited before creating its main window." }
    $mainWindow = [HomePanelUpdaterSmokeNativeMethods]::FindTopLevelWindow($homePanelProcess.Id, "HomePanelNativeWindow")
    if ($mainWindow -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($mainWindow -eq [IntPtr]::Zero) { throw "Restarted HomePanel did not create HomePanelNativeWindow." }

  if (-not [HomePanelUpdaterSmokeNativeMethods]::PostMessage(
      $mainWindow, [uint32]0x0112, [UIntPtr]([uint64]0xF060), [IntPtr]::Zero)) {
    throw "Failed to close the HomePanel instance restarted by the updater."
  }
  if (-not $homePanelProcess.WaitForExit(15000)) { throw "Restarted HomePanel did not exit after SC_CLOSE." }
  $homePanelProcess.Refresh()
  try { $homePanelExitCode = [int]$homePanelProcess.ExitCode } catch { $homePanelExitCode = $null }
  if ($null -ne $homePanelExitCode -and $homePanelExitCode -ne 0) {
    throw "Restarted HomePanel returned exit code $homePanelExitCode."
  }
  if (Test-Path -LiteralPath $homePanelLogPath) {
    throw "Restarted HomePanel unexpectedly created data/homepanel.log."
  }

  $applicationErrors = @(Get-ApplicationErrors -StartedAt $startedAt)
  if ($applicationErrors.Count -ne 0) { throw "Windows Application log contains HomePanel or updater error events." }

  [ordered]@{
    updater = $updaterPath
    updaterExitCode = $updaterProcess.ExitCode
    testedMode = "runner same-version verification"
    manifestRemoved = $true
    installedFilesUnchanged = $true
    homePanelRestarted = $true
    homePanelExitCode = $homePanelExitCode
    runtimeFileLoggingDisabled = $true
    version = $Version
    files = $after
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath (Join-Path $OutputDirectory "result.json") -Encoding utf8

  Write-Host "HomePanelUpdater runtime smoke test passed without runtime file logging."
} catch {
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $OutputDirectory "failure.txt") -Encoding utf8
  throw
} finally {
  if ($updaterProcess) {
    $updaterProcess.Refresh()
    if (-not $updaterProcess.HasExited) { Stop-Process -Id $updaterProcess.Id -Force -ErrorAction SilentlyContinue }
  }
  if ($homePanelProcess) {
    $homePanelProcess.Refresh()
    if (-not $homePanelProcess.HasExited) { Stop-Process -Id $homePanelProcess.Id -Force -ErrorAction SilentlyContinue }
  }
  Remove-Item -LiteralPath $installRoot -Recurse -Force -ErrorAction SilentlyContinue
}
