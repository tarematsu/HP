$ErrorActionPreference = 'Stop'

$logDir = Join-Path $PSScriptRoot '..\ci-logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$logPath = Join-Path $logDir 'stationhead-playback-api.log'
$lines = New-Object System.Collections.Generic.List[string]
$failed = $false

$channels = @('buddies', 'buddy46')
foreach ($channel in $channels) {
  $url = "https://skrzk.pages.dev/api/playback?channel=$channel"
  try {
    $response = Invoke-WebRequest -Uri $url -Headers @{ Origin = 'https://app.homepanel'; Accept = 'application/json' } -UseBasicParsing -TimeoutSec 20
    $contentType = [string]$response.Headers['Content-Type']
    $cors = [string]$response.Headers['Access-Control-Allow-Origin']
    $lines.Add("channel=$channel status=$($response.StatusCode) contentType=$contentType cors=$cors")
    if ($response.StatusCode -ne 200) {
      throw "HTTP $($response.StatusCode)"
    }
    if ($contentType -notmatch 'application/json') {
      throw "unexpected content type '$contentType'"
    }
    if ($cors -ne '*' -and $cors -ne 'https://app.homepanel') {
      throw "CORS does not allow https://app.homepanel; Access-Control-Allow-Origin='$cors'"
    }
    $json = $response.Content | ConvertFrom-Json
    if ($null -eq $json.ok) {
      throw "JSON is missing 'ok'"
    }
    $lines.Add("channel=$channel ok=$($json.ok) generated_at=$($json.generated_at) queue_count=$(@($json.queue).Count)")
  } catch {
    $failed = $true
    $lines.Add("channel=$channel error=$($_.Exception.Message)")
  }
}

$lines | Set-Content -LiteralPath $logPath -Encoding utf8
$lines | ForEach-Object { Write-Host $_ }
if ($failed) {
  throw "Stationhead playback API verification failed. See $logPath"
}
