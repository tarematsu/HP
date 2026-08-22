param(
  [Parameter(Mandatory = $true)][string]$Satellite,
  [Parameter(Mandatory = $true)][string]$Map,
  [Parameter(Mandatory = $true)][string]$SatelliteOutput,
  [Parameter(Mandatory = $true)][string]$MapOutput
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function Write-CroppedLayer {
  param(
    [Parameter(Mandatory = $true)][System.Drawing.Image]$Image,
    [Parameter(Mandatory = $true)][System.Drawing.Rectangle]$Source,
    [Parameter(Mandatory = $true)][string]$Output
  )

  $bitmap = $null
  $graphics = $null
  try {
    $bitmap = [System.Drawing.Bitmap]::new(
      $Source.Width,
      $Source.Height,
      [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    )
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighSpeed
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
    $destination = [System.Drawing.Rectangle]::new(0, 0, $Source.Width, $Source.Height)
    $graphics.DrawImage($Image, $destination, $Source, [System.Drawing.GraphicsUnit]::Pixel)

    $directory = [System.IO.Path]::GetDirectoryName($Output)
    if ($directory) { [System.IO.Directory]::CreateDirectory($directory) | Out-Null }
    $bitmap.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    if ($graphics) { $graphics.Dispose() }
    if ($bitmap) { $bitmap.Dispose() }
  }
}

$satelliteImage = $null
$mapImage = $null
try {
  $satelliteImage = [System.Drawing.Image]::FromFile($Satellite)
  $mapImage = [System.Drawing.Image]::FromFile($Map)
  if ($satelliteImage.Width -ne $mapImage.Width -or $satelliteImage.Height -ne $mapImage.Height) {
    throw "Radar source dimensions differ: satellite=$($satelliteImage.Width)x$($satelliteImage.Height), map=$($mapImage.Width)x$($mapImage.Height)"
  }

  # Keep the two layers separate so native composition remains:
  # satellite -> rain tiles -> white map. Only crop away the unused outer 60%.
  $cropWidth = [Math]::Max(1, [int][Math]::Round($satelliteImage.Width * 0.4))
  $cropHeight = [Math]::Max(1, [int][Math]::Round($satelliteImage.Height * 0.4))
  $cropLeft = [int][Math]::Floor(($satelliteImage.Width - $cropWidth) / 2)
  $cropTop = [int][Math]::Floor(($satelliteImage.Height - $cropHeight) / 2)
  $source = [System.Drawing.Rectangle]::new($cropLeft, $cropTop, $cropWidth, $cropHeight)

  Write-CroppedLayer -Image $satelliteImage -Source $source -Output $SatelliteOutput
  Write-CroppedLayer -Image $mapImage -Source $source -Output $MapOutput
}
finally {
  if ($mapImage) { $mapImage.Dispose() }
  if ($satelliteImage) { $satelliteImage.Dispose() }
}
