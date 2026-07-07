param(
  [ValidateSet("Release", "Debug")]
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root
$logPath = Join-Path $root "circleci-native-$($Configuration.ToLowerInvariant()).log"

function Write-Log([string]$Message) {
  $Message | Tee-Object -FilePath $logPath -Append
}

function Assert-ExitCode([string]$Description) {
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE"
  }
}

function Find-CMake {
  $command = Get-Command cmake.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $vsInstall = & $vswhere -latest -products * -property installationPath
    if (-not [string]::IsNullOrWhiteSpace($vsInstall)) {
      $bundled = Join-Path $vsInstall "Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
      if (Test-Path $bundled) { return $bundled }
    }
  }

  foreach ($candidate in @(
      "C:\Program Files\CMake\bin\cmake.exe",
      "C:\tools\cmake\bin\cmake.exe",
      "C:\ProgramData\chocolatey\bin\cmake.exe")) {
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

Remove-Item $logPath -Force -ErrorAction SilentlyContinue
Write-Log "=== $Configuration native build ==="

$cmake = Find-CMake
if ([string]::IsNullOrWhiteSpace($cmake)) {
  & choco install cmake --yes --no-progress *>&1 | Tee-Object -FilePath $logPath -Append
  Assert-ExitCode "CMake installation"
  $cmake = Find-CMake
}
if ([string]::IsNullOrWhiteSpace($cmake) -or -not (Test-Path $cmake)) {
  throw "CMake is unavailable"
}
& $cmake --version *>&1 | Tee-Object -FilePath $logPath -Append
Assert-ExitCode "CMake version check"

$webViewHeader = "native/packages/Microsoft.Web.WebView2.1.0.4022.49/build/native/include/WebView2.h"
if (-not (Test-Path $webViewHeader)) {
  & nuget install Microsoft.Web.WebView2 -Version 1.0.4022.49 -OutputDirectory native/packages -NonInteractive *>&1 |
    Tee-Object -FilePath $logPath -Append
  Assert-ExitCode "WebView2 SDK installation"
}

$buildNumber = if ([string]::IsNullOrWhiteSpace($env:CIRCLE_BUILD_NUM)) { "0" } else { $env:CIRCLE_BUILD_NUM }
$env:HOMEPANEL_BUILD_VERSION = "2.1.$buildNumber"
$buildDir = "native/build-$($Configuration.ToLowerInvariant())"

& $cmake -S native -B $buildDir -A x64 -DHOMEPANEL_CI_STRICT=OFF *>&1 |
  Tee-Object -FilePath $logPath -Append
Assert-ExitCode "$Configuration configure"

& $cmake --build $buildDir --config $Configuration --parallel 2 *>&1 |
  Tee-Object -FilePath $logPath -Append
Assert-ExitCode "$Configuration build"

$outputDir = Join-Path $buildDir $Configuration
foreach ($name in @("HomePanel.exe", "HomePanelUpdater.exe")) {
  $path = Join-Path $outputDir $name
  if (-not (Test-Path $path)) { throw "Required output is missing: $path" }
  if ((Get-Item $path).Length -le 0) { throw "Build output is empty: $path" }
  Write-Log "$name SHA256 $((Get-FileHash $path -Algorithm SHA256).Hash)"
}

Write-Log "=== $Configuration native build succeeded ==="
