[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet("device", "action")][string]$Kind,
  [string]$DataDirectory = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) "data")
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $DataDirectory | Out-Null
$secure = Read-Host "Enter $Kind token" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
$bytes = [Text.Encoding]::Unicode.GetBytes($plain)
$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$file = Join-Path $DataDirectory $(if ($Kind -eq "device") { "device-token.dat" } else { "action-token.dat" })
[IO.File]::WriteAllBytes($file, $protected)
Write-Host "Saved DPAPI-protected token: $file"
