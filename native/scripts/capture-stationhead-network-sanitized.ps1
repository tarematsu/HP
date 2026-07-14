[CmdletBinding()]
param(
  [string]$ChromePath,
  [string]$ProfileDir = (Join-Path $env:LOCALAPPDATA "HomePanel\StationheadCaptureProfile"),
  [string]$OutDir,
  [string]$Url = "https://stationhead.com/c/buddies",
  [int]$DebugPort = 9222,
  [int]$DurationSeconds = 300,
  [switch]$IncludeAllResourceTypes
)

# Captures Stationhead's own XHR/Fetch responses and WebSocket frames through
# Chrome DevTools Protocol, but writes a sanitized analysis log. It never
# calls Stationhead APIs itself. Do not treat the output as a guarantee of
# privacy: visible account/chat content is intentionally retained for analysis.

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
  $OutDir = Join-Path $repoRoot "native\data\stationhead-capture"
}

function Resolve-ChromePath {
  param([string]$Explicit)
  if ($Explicit) { return $Explicit }
  foreach ($candidate in @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")) {
    if (Test-Path $candidate) { return $candidate }
  }
  throw "Chrome executable not found. Pass -ChromePath explicitly."
}

function Sanitize-Url {
  param([string]$Value)
  try {
    $uri = [Uri]$Value
    $query = if ($uri.Query) {
      ($uri.Query.TrimStart('?') -split '&' | Where-Object { $_ } |
        ForEach-Object { ($_ -split '=', 2)[0] + '=<redacted>' }) -join '&'
    } else { "" }
    $base = $uri.GetLeftPart([System.UriPartial]::Path)
    return $(if ($query) { "$base`?$query" } else { $base })
  } catch { return "<invalid-url>" }
}

function Test-SensitiveName {
  param([string]$Name)
  return $Name -match '(?i)(authorization|cookie|token|secret|password|passwd|api[-_]?key|session|credential|jwt|bearer|private)'
}

function Sanitize-Text {
  param([AllowNull()][string]$Value)
  if ($null -eq $Value) { return $null }
  $result = $Value -replace '(?i)Bearer\s+[A-Za-z0-9._~+/=-]+', 'Bearer <redacted>'
  $result = $result -replace '(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?![A-Za-z0-9_-])', '<jwt-redacted>'
  return $result
}

function Sanitize-Value {
  param($Value, [string]$Name = "")
  if (Test-SensitiveName $Name) { return '<redacted>' }
  if ($null -eq $Value) { return $null }
  if ($Value -is [PSCustomObject]) {
    $copy = [ordered]@{}
    foreach ($property in $Value.PSObject.Properties) {
      $copy[$property.Name] = Sanitize-Value $property.Value $property.Name
    }
    return $copy
  }
  if ($Value -is [System.Collections.IDictionary]) {
    $copy = [ordered]@{}
    foreach ($key in $Value.Keys) { $copy[$key] = Sanitize-Value $Value[$key] ([string]$key) }
    return $copy
  }
  if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string]) {
    return @($Value | ForEach-Object { Sanitize-Value $_ $Name })
  }
  if ($Value -is [string]) { return Sanitize-Text $Value }
  return $Value
}

function Sanitize-Body {
  param([AllowNull()][string]$Body)
  if ($null -eq $Body) { return $null }
  try {
    $parsed = $Body | ConvertFrom-Json
    return (($parsed | ForEach-Object { Sanitize-Value $_ }) | ConvertTo-Json -Depth 50 -Compress)
  } catch {
    return Sanitize-Text $Body
  }
}

function Send-Cdp {
  param($Socket, [ref]$MessageId, [string]$Method, [hashtable]$Params, $Token)
  $MessageId.Value++
  $payload = @{ id = $MessageId.Value; method = $Method; params = $Params } |
    ConvertTo-Json -Depth 20 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $Socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, $Token).GetAwaiter().GetResult() | Out-Null
  return $MessageId.Value
}

function Receive-Cdp {
  param($Socket, $Token)
  $buffer = [byte[]]::new(1MB)
  $segment = [ArraySegment[byte]]::new($buffer)
  $text = [Text.StringBuilder]::new()
  do {
    $part = $Socket.ReceiveAsync($segment, $Token).GetAwaiter().GetResult()
    if ($part.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { return $null }
    $text.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $part.Count)) | Out-Null
  } while (-not $part.EndOfMessage)
  return $text.ToString()
}

$chrome = Resolve-ChromePath $ChromePath
New-Item -ItemType Directory -Force -Path $ProfileDir, $OutDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outFile = Join-Path $OutDir "sanitized-capture-$stamp.jsonl"
$chromeArgs = @("--remote-debugging-port=$DebugPort", "--user-data-dir=$ProfileDir", "--no-first-run", "--no-default-browser-check", $Url)
$process = Start-Process -FilePath $chrome -ArgumentList $chromeArgs -PassThru

$target = $null
for ($i = 0; $i -lt 60 -and -not $target; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $target = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json/list" -TimeoutSec 2 |
      Where-Object { $_.type -eq "page" -and $_.url -like "*stationhead.com*" } | Select-Object -First 1
  } catch { }
}
if (-not $target) { throw "Stationhead tab was not found on CDP port $DebugPort." }

$socket = [Net.WebSockets.ClientWebSocket]::new()
$connectToken = [Threading.CancellationTokenSource]::new(5000)
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, $connectToken.Token).GetAwaiter().GetResult()
$messageId = 0
$runCts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($DurationSeconds))
$token = $runCts.Token
$writer = [IO.StreamWriter]::new($outFile, $false, [Text.Encoding]::UTF8)
$requests = @{}
$responses = @{}
$pending = @{}
$captured = 0

function Interesting-Type([string]$Type) {
  if ($IncludeAllResourceTypes) { return $true }
  return $Type -in @('XHR', 'Fetch', 'WebSocket', 'EventSource', 'Document')
}

try {
  Send-Cdp $socket ([ref]$messageId) 'Network.enable' @{} $token | Out-Null
  while ($true) {
    try { $raw = Receive-Cdp $socket $token } catch [OperationCanceledException] { break }
    if (-not $raw) { continue }
    $message = $raw | ConvertFrom-Json

    if ($message.id -and $pending.ContainsKey([string]$message.id)) {
      $requestId = $pending[[string]$message.id]; $pending.Remove([string]$message.id)
      $request = $requests[$requestId]; $response = $responses[$requestId]
      if ($request) {
        $entry = [ordered]@{
          kind = 'http'; requestId = $requestId; method = $request.method
          url = Sanitize-Url $request.url; resourceType = $request.type
          requestHeaders = Sanitize-Value $request.headers
          postData = Sanitize-Body $request.postData; status = $response.status
          mimeType = $response.mimeType; responseHeaders = Sanitize-Value $response.headers
          bodyBase64Encoded = [bool]$message.result.base64Encoded
          body = Sanitize-Body $message.result.body; capturedAt = (Get-Date).ToString('o')
        }
        $writer.WriteLine(($entry | ConvertTo-Json -Depth 50 -Compress)); $writer.Flush(); $captured++
        Write-Host "[$($response.status)] $($request.method) $(Sanitize-Url $request.url)"
      }
      $requests.Remove($requestId); $responses.Remove($requestId); continue
    }

    switch ($message.method) {
      'Network.requestWillBeSent' {
        $p = $message.params
        $requests[$p.requestId] = @{ url=$p.request.url; method=$p.request.method; headers=$p.request.headers; postData=$p.request.postData; type=$p.type }
      }
      'Network.responseReceived' {
        $p = $message.params
        $responses[$p.requestId] = @{ status=$p.response.status; mimeType=$p.response.mimeType; headers=$p.response.headers }
      }
      'Network.loadingFinished' {
        $requestId = $message.params.requestId
        if ($requests.ContainsKey($requestId) -and (Interesting-Type $requests[$requestId].type)) {
          $command = Send-Cdp $socket ([ref]$messageId) 'Network.getResponseBody' @{ requestId=$requestId } $token
          $pending[[string]$command] = $requestId
        } else { $requests.Remove($requestId); $responses.Remove($requestId) }
      }
      'Network.loadingFailed' { $requests.Remove($message.params.requestId); $responses.Remove($message.params.requestId) }
      'Network.webSocketCreated' {
        $entry = [ordered]@{ kind='websocket_created'; requestId=$message.params.requestId; url=Sanitize-Url $message.params.url; capturedAt=(Get-Date).ToString('o') }
        $writer.WriteLine(($entry | ConvertTo-Json -Compress)); $writer.Flush()
      }
      'Network.webSocketFrameSent' {
        $entry = [ordered]@{ kind='websocket_sent'; requestId=$message.params.requestId; payloadData=Sanitize-Body $message.params.response.payloadData; capturedAt=(Get-Date).ToString('o') }
        $writer.WriteLine(($entry | ConvertTo-Json -Depth 50 -Compress)); $writer.Flush(); $captured++
      }
      'Network.webSocketFrameReceived' {
        $entry = [ordered]@{ kind='websocket_received'; requestId=$message.params.requestId; payloadData=Sanitize-Body $message.params.response.payloadData; capturedAt=(Get-Date).ToString('o') }
        $writer.WriteLine(($entry | ConvertTo-Json -Depth 50 -Compress)); $writer.Flush(); $captured++
      }
    }
  }
} finally {
  $writer.Flush(); $writer.Close(); try { $socket.Dispose() } catch { }
}

Write-Host "Done. Captured $captured sanitized entries."
Write-Host "Saved to: $outFile"
Write-Host "The Chrome window was left running; close it manually when finished."
Write-Host "Visible account/chat content is retained, but auth headers and token-like fields are redacted."
