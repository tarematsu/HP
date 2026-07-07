param(
  [Parameter(Mandatory = $true)]
  [string]$SatelliteOutputPath,

  [Parameter(Mandatory = $true)]
  [string]$MapOutputPath
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

$width = 800
$height = 520
$radarZoom = 11
$satelliteZoom = 12
$mapZoom = 11
$latitude = 35.891991
$longitude = 139.486375
$tileSize = 256

$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(30)
$client.DefaultRequestHeaders.UserAgent.ParseAdd('HomePanel-build/1.0')

function Ensure-OutputDirectory([string]$Path) {
  $directory = Split-Path -Parent $Path
  if ($directory) {
    [System.IO.Directory]::CreateDirectory($directory) | Out-Null
  }
}

function Get-TileImage([string]$Url) {
  $bytes = $client.GetByteArrayAsync($Url).GetAwaiter().GetResult()
  $stream = [System.IO.MemoryStream]::new($bytes, $false)
  try {
    $source = [System.Drawing.Image]::FromStream($stream)
    try {
      return [System.Drawing.Bitmap]::new($source)
    } finally {
      $source.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function Get-LayerLayout([int]$Zoom, [int]$LayerWidth, [int]$LayerHeight) {
  $scale = [Math]::Pow(2, $Zoom)
  $worldX = (($longitude + 180.0) / 360.0) * $scale * $tileSize
  $latitudeRadians = [Math]::Max(-85.05112878, [Math]::Min(85.05112878, $latitude)) * [Math]::PI / 180.0
  $worldY = (1.0 - [Math]::Log([Math]::Tan($latitudeRadians) + (1.0 / [Math]::Cos($latitudeRadians))) / [Math]::PI) / 2.0 * $scale * $tileSize
  $left = $worldX - $LayerWidth / 2.0
  $top = $worldY - $LayerHeight / 2.0
  return [pscustomobject]@{
    Left = $left
    Top = $top
    MinX = [Math]::Floor($left / $tileSize)
    MaxX = [Math]::Floor(($left + $LayerWidth - 1) / $tileSize)
    MinY = [Math]::Floor($top / $tileSize)
    MaxY = [Math]::Floor(($top + $LayerHeight - 1) / $tileSize)
  }
}

function New-TileLayer(
  [int]$Zoom,
  [int]$LayerWidth,
  [int]$LayerHeight,
  [string]$UrlTemplate,
  [System.Drawing.Color]$Background
) {
  $layout = Get-LayerLayout $Zoom $LayerWidth $LayerHeight
  $bitmap = [System.Drawing.Bitmap]::new(
    $LayerWidth,
    $LayerHeight,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear($Background)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

    foreach ($y in $layout.MinY..$layout.MaxY) {
      foreach ($x in $layout.MinX..$layout.MaxX) {
        $destinationX = [Math]::Round($x * $tileSize - $layout.Left)
        $destinationY = [Math]::Round($y * $tileSize - $layout.Top)
        $url = $UrlTemplate.Replace('{z}', [string]$Zoom).Replace('{x}', [string]$x).Replace('{y}', [string]$y)
        $tile = Get-TileImage $url
        try {
          $graphics.DrawImage($tile, [int]$destinationX, [int]$destinationY, $tileSize, $tileSize)
        } finally {
          $tile.Dispose()
        }
      }
    }
  } catch {
    $bitmap.Dispose()
    throw
  } finally {
    $graphics.Dispose()
  }
  return $bitmap
}

function Resize-Layer(
  [System.Drawing.Bitmap]$Source,
  [int]$TargetWidth,
  [int]$TargetHeight,
  [System.Drawing.Color]$Background,
  [System.Drawing.Drawing2D.InterpolationMode]$InterpolationMode
) {
  $bitmap = [System.Drawing.Bitmap]::new(
    $TargetWidth,
    $TargetHeight,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear($Background)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $graphics.InterpolationMode = $InterpolationMode
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.DrawImage($Source, 0, 0, $TargetWidth, $TargetHeight)
  } catch {
    $bitmap.Dispose()
    throw
  } finally {
    $graphics.Dispose()
  }
  return $bitmap
}

function Convert-WhiteToTransparency([System.Drawing.Bitmap]$Bitmap) {
  $rectangle = [System.Drawing.Rectangle]::new(0, 0, $Bitmap.Width, $Bitmap.Height)
  $data = $Bitmap.LockBits(
    $rectangle,
    [System.Drawing.Imaging.ImageLockMode]::ReadWrite,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  try {
    $stride = [Math]::Abs($data.Stride)
    $length = $stride * $data.Height
    $pixels = [byte[]]::new($length)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $pixels, 0, $length)

    for ($y = 0; $y -lt $data.Height; $y++) {
      $row = $y * $stride
      for ($x = 0; $x -lt $data.Width; $x++) {
        $offset = $row + $x * 4
        $blue = [int]$pixels[$offset]
        $green = [int]$pixels[$offset + 1]
        $red = [int]$pixels[$offset + 2]
        $minimum = [Math]::Min($red, [Math]::Min($green, $blue))
        $maximum = [Math]::Max($red, [Math]::Max($green, $blue))

        if ($minimum -ge 246) {
          $pixels[$offset + 3] = 0
        } elseif ($minimum -ge 220 -and ($maximum - $minimum) -le 10) {
          $alpha = [Math]::Round((246 - $minimum) * 255.0 / 26.0)
          $pixels[$offset + 3] = [byte][Math]::Max(0, [Math]::Min(255, $alpha))
        }
      }
    }

    [System.Runtime.InteropServices.Marshal]::Copy($pixels, 0, $data.Scan0, $length)
  } finally {
    $Bitmap.UnlockBits($data)
  }
}

Ensure-OutputDirectory $SatelliteOutputPath
Ensure-OutputDirectory $MapOutputPath

$satelliteScale = [Math]::Pow(2.0, $satelliteZoom - $radarZoom)
$mapScale = [Math]::Pow(2.0, $mapZoom - $radarZoom)
$satelliteSourceWidth = [int][Math]::Ceiling($width * $satelliteScale)
$satelliteSourceHeight = [int][Math]::Ceiling($height * $satelliteScale)
$mapSourceWidth = [int][Math]::Ceiling($width * $mapScale)
$mapSourceHeight = [int][Math]::Ceiling($height * $mapScale)

try {
  $satelliteSource = New-TileLayer $satelliteZoom $satelliteSourceWidth $satelliteSourceHeight 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg' ([System.Drawing.Color]::FromArgb(255, 5, 8, 13))
  try {
    $satellite = Resize-Layer $satelliteSource $width $height ([System.Drawing.Color]::FromArgb(255, 5, 8, 13)) ([System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic)
    try {
      $satellite.Save($SatelliteOutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $satellite.Dispose()
    }
  } finally {
    $satelliteSource.Dispose()
  }

  $mapSource = New-TileLayer $mapZoom $mapSourceWidth $mapSourceHeight 'https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png' ([System.Drawing.Color]::Transparent)
  try {
    Convert-WhiteToTransparency $mapSource
    if ($mapSourceWidth -eq $width -and $mapSourceHeight -eq $height) {
      $mapSource.Save($MapOutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } else {
      $map = Resize-Layer $mapSource $width $height ([System.Drawing.Color]::Transparent) ([System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic)
      try {
        Convert-WhiteToTransparency $map
        $map.Save($MapOutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $map.Dispose()
      }
    }
  } finally {
    $mapSource.Dispose()
  }
} finally {
  $client.Dispose()
}

foreach ($path in @($SatelliteOutputPath, $MapOutputPath)) {
  if (-not (Test-Path $path) -or (Get-Item $path).Length -le 0) {
    throw "Radar layer was not generated: $path"
  }
}
