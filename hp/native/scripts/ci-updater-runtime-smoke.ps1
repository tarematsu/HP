[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$HomePanelExecutable,

  [Parameter(Mandatory = $true)]
  [string]$UpdaterExecutable,

  [Parameter(Mandatory = $true)]
  [string]$WebView2Loader,

  [Parameter(Mandatory = $true)]
  [string]$Version,

  [string]$ConfigExample,

  [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$homePanelSource = (Resolve-Path -LiteralPath $HomePanelExecutable).Path
$updaterSource = (Resolve-Path -LiteralPath $UpdaterExecutable).Path
$loaderSource = (Resolve-Path -LiteralPath $WebView2Loader).Path
if ($ConfigExample) {
  $configSource = (Resolve-Path -LiteralPath $ConfigExample).Path
} else {
  $configSource = $null
}

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path (Split-Path -Parent $updaterSource) "ci-updater-runtime-smoke"
}
$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$installRoot = Join-Path $OutputDirectory "install-root"
$dataDirectory = Join-Path $installRoot "data"
$manifestPath = Join-Path $dataDirectory "pending-update.json"
$resultPath = Join-Path $OutputDirectory "result.json"
$eventPath = Join-Path $OutputDirectory "application-errors.txt"

Remove-Item -LiteralPath $OutputDirectory -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $installRoot, $dataDirectory | Out-Null
Copy-Item -LiteralPath $homePanelSource -Destination (Join-Path $installRoot "HomePanel.exe") -Force
Copy-Item -LiteralPath $updaterSource -Destination (Join-Path $installRoot "HomePanelUpdater.exe") -Force
Copy-Item -LiteralPath $loaderSource -Destination (Join-Path $installRoot "WebView2Loader.dll") -Force
if ($configSource) {
  Copy-Item -LiteralPath $configSource -Destination (Join-Path $installRoot "config.example.json") -Force
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class HomePanelUpdaterSmokeNativeMethods
{
    public delegate bool EnumWindowsProc(IntPtr window, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder className, int maximumCount);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool PostMessage(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam);

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

    public static int CloseOwnedWindows(int processId)
    {
        int count = 0;
        EnumWindows((window, parameter) =>
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == (uint)processId)
            {
                PostMessage(window, 0x0010, UIntPtr.Zero, IntPtr.Zero);
                count++;
            }
            return true;
        }, IntPtr.Zero);
        return count;
    }
}
'@

function Get-InstalledFileState {
  param([Parameter(Mandatory = $true)][string]$Path)

  $item = Get-Item -LiteralPath $Path
  return [ordered]@{
    name = $item.Name
    path = $item.FullName
    size = [int64]$item.Length
    sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  }
}

function Find-HomePanelProcess {
  param([Parameter(Mandatory = $true)][string]$ExecutablePath)

  $normalized = [System.IO.Path]::GetFullPath($ExecutablePath)
  $candidate = Get-CimInstance Win32_Process -Filter "Name = 'HomePanel.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.ExecutablePath -and
      [String]::Equals(
        [System.IO.Path]::GetFullPath($_.ExecutablePath),
        $normalized,
        [StringComparison]::OrdinalIgnoreCase)
    } |
    Select-Object -First 1
  if (-not $candidate) { return $null }
  return Get-Process -Id ([int]$candidate.ProcessId) -ErrorAction SilentlyContinue
}

function Save-ApplicationEvents {
  param([Parameter(Mandatory = $true)][datetime]$StartedAt)

  $events = @(
    Get-WinEvent -FilterHashtable @{
      LogName = "Application"
      StartTime = $StartedAt.AddSeconds(-2)
      Level = 2
    } -ErrorAction SilentlyContinue |
      Where-Object { $_.Message -match "(?i)HomePanel(?:Updater)?\.exe" }
  )
  if ($events.Count -eq 0) {
    "No HomePanel or HomePanelUpdater application-error events." |
      Set-Content -LiteralPath $eventPath -Encoding utf8
  } else {
    $events |
      Format-List TimeCreated, ProviderName, Id, LevelDisplayName, Message |
      Out-String -Width 240 |
      Set-Content -LiteralPath $eventPath -Encoding utf8
  }
  return $events
}

$installedPaths = @(
  (Join-Path $installRoot "HomePanel.exe"),
  (Join-Path $installRoot "HomePanelUpdater.exe"),
  (Join-Path $installRoot "WebView2Loader.dll")
)
$before = @($installedPaths | ForEach-Object { Get-InstalledFileState -Path $_ })
$manifest = [ordered]@{
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
}
$manifest | ConvertTo-Json -Depth 5 |
  Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM

$updaterPath = Join-Path $installRoot "HomePanelUpdater.exe"
$homePanelPath = Join-Path $installRoot "HomePanel.exe"
$updaterLogPath = Join-Path $dataDirectory "homepanel-updater.log"
$homePanelLogPath = Join-Path $dataDirectory "homepanel.log"
$updaterProcess = $null
$homePanelProcess = $null
$startedAt = Get-Date

try {
  Write-Host "Starting HomePanelUpdater runner-mode smoke test."
  Write-Host "The manifest matches the installed binaries, so no network access or audio playback is required."

  $arguments = @(
    "--pid", [string]$PID,
    "--app-pid", [string]$PID,
    "--root", $installRoot,
    "--manifest", $manifestPath,
    "--version", $Version
  )
  $updaterProcess = Start-Process \
    -FilePath $updaterPath \
    -ArgumentList $arguments \
    -WorkingDirectory $installRoot \
    -PassThru

  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  while (-not $updaterProcess.HasExited -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 250
    $updaterProcess.Refresh()
  }
  if (-not $updaterProcess.HasExited) {
    [HomePanelUpdaterSmokeNativeMethods]::CloseOwnedWindows($updaterProcess.Id) | Out-Null
    if (-not $updaterProcess.WaitForExit(5000)) {
      Stop-Process -Id $updaterProcess.Id -Force -ErrorAction SilentlyContinue
    }
    throw "HomePanelUpdater did not finish within 60 seconds."
  }
  if ($updaterProcess.ExitCode -ne 0) {
    throw "HomePanelUpdater returned exit code $($updaterProcess.ExitCode)."
  }

  if (Test-Path -LiteralPath $manifestPath) {
    throw "HomePanelUpdater did not remove the verified pending manifest."
  }
  if (-not (Test-Path -LiteralPath $updaterLogPath)) {
    throw "HomePanelUpdater did not create data/homepanel-updater.log."
  }

  $updaterLog = Get-Content -LiteralPath $updaterLogPath -Raw
  if (-not $updaterLog.Contains("Same-version verification succeeded; no repair was required")) {
    throw "Updater log does not contain the same-version verification success marker."
  }
  if ($updaterLog -match "(?im)Update failed|backup restoration also failed|manual package recovery") {
    throw "Updater log contains a failure marker."
  }

  $after = @($installedPaths | ForEach-Object { Get-InstalledFileState -Path $_ })
  for ($index = 0; $index -lt $before.Count; $index++) {
    if ($before[$index].size -ne $after[$index].size -or
        $before[$index].sha256 -ne $after[$index].sha256) {
      throw "Same-version verification unexpectedly modified $($before[$index].name)."
    }
  }

  $restartDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $restartDeadline) {
    $homePanelProcess = Find-HomePanelProcess -ExecutablePath $homePanelPath
    if ($homePanelProcess) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $homePanelProcess) {
    throw "HomePanelUpdater did not restart HomePanel.exe."
  }

  $mainWindow = [IntPtr]::Zero
  $windowDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while ([DateTime]::UtcNow -lt $windowDeadline) {
    $homePanelProcess.Refresh()
    if ($homePanelProcess.HasExited) {
      throw "Restarted HomePanel exited before creating its main window."
    }
    $mainWindow = [HomePanelUpdaterSmokeNativeMethods]::FindTopLevelWindow(
      $homePanelProcess.Id, "HomePanelNativeWindow")
    if ($mainWindow -ne [IntPtr]::Zero) { break }
    Start-Sleep -Milliseconds 250
  }
  if ($mainWindow -eq [IntPtr]::Zero) {
    throw "Restarted HomePanel did not create HomePanelNativeWindow."
  }

  $wmSysCommand = [uint32]0x0112
  $scClose = [uint64]0xF060
  if (-not [HomePanelUpdaterSmokeNativeMethods]::PostMessage(
      $mainWindow, $wmSysCommand, [UIntPtr]$scClose, [IntPtr]::Zero)) {
    throw "Failed to close the HomePanel instance restarted by the updater."
  }
  if (-not $homePanelProcess.WaitForExit(15000)) {
    throw "Restarted HomePanel did not exit after SC_CLOSE."
  }
  if ($homePanelProcess.ExitCode -ne 0) {
    throw "Restarted HomePanel returned exit code $($homePanelProcess.ExitCode)."
  }

  if (-not (Test-Path -LiteralPath $homePanelLogPath)) {
    throw "Restarted HomePanel did not create data/homepanel.log."
  }
  $homePanelLog = Get-Content -LiteralPath $homePanelLogPath -Raw
  if (-not $homePanelLog.Contains("HomePanel exiting code 0")) {
    throw "Restarted HomePanel log does not contain a clean-exit marker."
  }
  if ($homePanelLog -match "(?im)Unhandled exception|std::terminate|HomePanel exiting code [1-9]") {
    throw "Restarted HomePanel log contains a fatal marker."
  }

  $applicationErrors = @(Save-ApplicationEvents -StartedAt $startedAt)
  if ($applicationErrors.Count -ne 0) {
    throw "Windows Application log contains HomePanel or updater error events."
  }

  Copy-Item -LiteralPath $updaterLogPath -Destination (Join-Path $OutputDirectory "homepanel-updater.log") -Force
  Copy-Item -LiteralPath $homePanelLogPath -Destination (Join-Path $OutputDirectory "homepanel.log") -Force

  [ordered]@{
    updater = $updaterPath
    updaterExitCode = $updaterProcess.ExitCode
    testedMode = "runner same-version verification"
    networkRequired = $false
    playbackRequired = $false
    manifestRemoved = $true
    installedFilesUnchanged = $true
    homePanelRestarted = $true
    homePanelExitCode = $homePanelProcess.ExitCode
    version = $Version
    files = $after
    completedAtUtc = [DateTime]::UtcNow.ToString("o")
  } | ConvertTo-Json -Depth 6 |
    Set-Content -LiteralPath $resultPath -Encoding utf8

  Write-Host "HomePanelUpdater runtime smoke test passed."
} catch {
  if ($updaterProcess) {
    $updaterProcess.Refresh()
    if (-not $updaterProcess.HasExited) {
      [HomePanelUpdaterSmokeNativeMethods]::CloseOwnedWindows($updaterProcess.Id) | Out-Null
      Stop-Process -Id $updaterProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }
  if ($homePanelProcess) {
    $homePanelProcess.Refresh()
    if (-not $homePanelProcess.HasExited) {
      Stop-Process -Id $homePanelProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }

  if (Test-Path -LiteralPath $updaterLogPath) {
    Copy-Item -LiteralPath $updaterLogPath -Destination (Join-Path $OutputDirectory "homepanel-updater.log") -Force -ErrorAction SilentlyContinue
    Write-Host "----- HomePanelUpdater log -----"
    Get-Content -LiteralPath $updaterLogPath -ErrorAction SilentlyContinue | Write-Host
  }
  if (Test-Path -LiteralPath $homePanelLogPath) {
    Copy-Item -LiteralPath $homePanelLogPath -Destination (Join-Path $OutputDirectory "homepanel.log") -Force -ErrorAction SilentlyContinue
  }
  Save-ApplicationEvents -StartedAt $startedAt | Out-Null
  $_ | Out-String | Set-Content -LiteralPath (Join-Path $OutputDirectory "failure.txt") -Encoding utf8
  throw
}
