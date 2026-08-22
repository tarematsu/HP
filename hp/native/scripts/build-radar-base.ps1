param(
  [Parameter(Mandatory = $true)][string]$Satellite,
  [Parameter(Mandatory = $true)][string]$Map,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$satelliteImage = $null
$mapImage = $null
$outputBitmap = $null
$graphics = $null
try {
  $satelliteImage = [System.Drawing.Image]::FromFile($Satellite)
  $mapImage = [System.Drawing.Image]::FromFile($Map)
  if ($satelliteImage.Width -ne $mapImage.Width -or $satelliteImage.Height -ne $mapImage.Height) {
    throw "Radar source dimensions differ: satellite=$($satelliteImage.Width)x$($satelliteImage.Height), map=$($mapImage.Width)x$($mapImage.Height)"
  }

  # The native radar now uses only the geographic center 40% of the former
  # viewport. Crop before packaging so the executable never carries or decodes
  # the unused outer 60%.
  $cropWidth = [Math]::Max(1, [int][Math]::Round($satelliteImage.Width * 0.4))
  $cropHeight = [Math]::Max(1, [int][Math]::Round($satelliteImage.Height * 0.4))
  $cropLeft = [int][Math]::Floor(($satelliteImage.Width - $cropWidth) / 2)
  $cropTop = [int][Math]::Floor(($satelliteImage.Height - $cropHeight) / 2)

  $outputBitmap = [System.Drawing.Bitmap]::new(
    $cropWidth,
    $cropHeight,
    [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  )
  $graphics = [System.Drawing.Graphics]::FromImage($outputBitmap)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half

  $destination = [System.Drawing.Rectangle]::new(0, 0, $cropWidth, $cropHeight)
  $source = [System.Drawing.Rectangle]::new($cropLeft, $cropTop, $cropWidth, $cropHeight)
  $graphics.DrawImage($satelliteImage, $destination, $source, [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.DrawImage($mapImage, $destination, $source, [System.Drawing.GraphicsUnit]::Pixel)

  $directory = [System.IO.Path]::GetDirectoryName($Output)
  if ($directory) { [System.IO.Directory]::CreateDirectory($directory) | Out-Null }
  $outputBitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
  if ($graphics) { $graphics.Dispose() }
  if ($outputBitmap) { $outputBitmap.Dispose() }
  if ($mapImage) { $mapImage.Dispose() }
  if ($satelliteImage) { $satelliteImage.Dispose() }
}
